import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs } from 'ai'
import pLimit from 'p-limit'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE1_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { updateManifestForExtractedTest } from './extract-incremental.js'
import type { IncrementalManifest } from './incremental.js'
import { saveManifest } from './incremental.js'
import type { Progress } from './progress.js'
import {
  getFailedTestAttempts,
  markFileDone,
  markTestDone,
  markTestFailed,
  resetPhase2AndPhase3,
  saveProgress,
} from './progress.js'
import type { ExtractedBehavior } from './report-writer.js'
import { writeBehaviorFile } from './report-writer.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'
import { makeAuditTools } from './tools.js'

interface Phase1RunInput {
  readonly testFiles: readonly ParsedTestFile[]
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
}

function getEnvOrFallback(name: string, fallback: string): string {
  const value = process.env[name]
  if (value === undefined) return fallback
  return value
}

interface GenerationStep {
  readonly toolCalls: readonly unknown[] | undefined
}

function getToolCallsForStep(step: GenerationStep): number {
  return step.toolCalls === undefined ? 0 : step.toolCalls.length
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({ name: 'behavior-audit', apiKey, baseURL: BASE_URL })
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are a senior software analyst examining a unit test from a Telegram/Discord/Mattermost chat bot called "papai" that manages tasks via LLM tool-calling. Your job is to understand what real-world behavior this test verifies and describe it in plain language that a non-programmer could understand.

You have tools to read source files, search the codebase, find files, and list directories. Use them to understand the implementation behind the test — follow imports, read the functions being tested, understand the full chain from user input to bot response.

Respond with ONLY a JSON object:
{
  "behavior": "Plain-language description of what the bot does in this scenario, written as if explaining to someone who has never seen code. Start with 'When...' to describe the trigger, then describe what happens.",
  "context": "Technical context about HOW this works internally — what functions are called, what the data flow looks like. This is for developers reviewing the audit."
}`

interface ExtractionResult {
  readonly behavior: string
  readonly context: string
}

function isValidExtraction(raw: unknown): raw is Record<'behavior' | 'context', string> {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'behavior' in raw &&
    typeof raw.behavior === 'string' &&
    'context' in raw &&
    typeof raw.context === 'string'
  )
}

function parseJsonResponse(text: string): ExtractionResult | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch === null) return null
    const raw: unknown = JSON.parse(jsonMatch[0])
    if (isValidExtraction(raw)) return { behavior: raw.behavior, context: raw.context }
    return null
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function deriveImplPath(testPath: string): string {
  return testPath.replace(/^tests\//, 'src/').replace(/\.test\.ts$/, '.ts')
}

function buildUserMessage(testCase: TestCase, testFilePath: string): string {
  const implPath = deriveImplPath(testFilePath)
  return `**Test file:** ${testFilePath}\n**Test name:** ${testCase.fullPath}\n**Likely implementation file:** ${implPath}\n\n\`\`\`typescript\n${testCase.source}\n\`\`\``
}

async function extractSingleTest(
  testCase: TestCase,
  testFilePath: string,
  attempt: number,
): Promise<ExtractionResult | null> {
  const timeout = attempt > 0 ? PHASE1_TIMEOUT_MS * 2 : PHASE1_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()
  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: buildUserMessage(testCase, testFilePath),
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal: AbortSignal.timeout(timeout),
    })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const toolCallCount = result.steps.reduce((sum, step) => sum + getToolCallsForStep(step), 0)
    const parsed = parseJsonResponse(result.text)
    if (parsed === null) {
      console.log(`    ✗ malformed JSON (${elapsed}s)`)
      return null
    }
    console.log(`    ✓ (${elapsed}s, ${toolCallCount} tool calls)`)
    return parsed
  } catch (error) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`    ✗ ${error instanceof Error ? error.message : String(error)} (${elapsed}s)`)
    return null
  }
}

function retryExtraction(testCase: TestCase, testFilePath: string, attempt: number): Promise<ExtractionResult | null> {
  return extractSingleTest(testCase, testFilePath, attempt).then((result) => {
    if (result !== null || attempt >= MAX_RETRIES - 1) return result
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!
    return sleep(backoff).then(() => retryExtraction(testCase, testFilePath, attempt + 1))
  })
}

async function processSingleTestCase(
  testCase: TestCase,
  testFile: ParsedTestFile,
  testFilePath: string,
  displayIndex: number,
  totalTests: number,
  progress: Progress,
  manifest: IncrementalManifest,
): Promise<{
  readonly behavior: ExtractedBehavior
  readonly manifest: IncrementalManifest
  readonly phase1Changed: boolean
} | null> {
  const testKey = `${testFilePath}::${testCase.fullPath}`
  const existing = progress.phase1.extractedBehaviors[testKey]
  if (existing !== undefined) {
    return { behavior: existing, manifest, phase1Changed: false }
  }
  if (getFailedTestAttempts(progress, testKey) >= MAX_RETRIES) {
    console.log(`  [${displayIndex}/${totalTests}] "${testCase.name}" (skipped, max retries reached)`)
    return null
  }
  process.stdout.write(`  [${displayIndex}/${totalTests}] "${testCase.name}" `)
  const extracted = await retryExtraction(testCase, testFilePath, 0)
  if (extracted === null) {
    markTestFailed(progress, testKey, 'extraction failed')
    return null
  }
  const behavior: ExtractedBehavior = {
    testName: testCase.name,
    fullPath: testCase.fullPath,
    behavior: extracted.behavior,
    context: extracted.context,
  }
  markTestDone(progress, testFilePath, testKey, behavior)
  const { manifest: updatedManifest, phase1Changed } = await updateManifestForExtractedTest({
    manifest,
    testFile,
    testCase,
    extractedBehavior: behavior,
  })
  await saveManifest(updatedManifest)
  return { behavior, manifest: updatedManifest, phase1Changed }
}

async function runSelectedExtractions(input: {
  readonly selectedTests: readonly TestCase[]
  readonly testFile: ParsedTestFile
  readonly progress: Progress
  readonly manifest: IncrementalManifest
}): Promise<{
  readonly results: readonly ({
    readonly behavior: ExtractedBehavior
    readonly manifest: IncrementalManifest
    readonly phase1Changed: boolean
  } | null)[]
  readonly manifest: IncrementalManifest
  readonly anyPhase1Changed: boolean
}> {
  let currentManifest = input.manifest
  let anyPhase1Changed = false
  const limit = pLimit(1)
  const results = await Promise.all(
    input.selectedTests.map((testCase, index) =>
      limit(async () => {
        const result = await processSingleTestCase(
          testCase,
          input.testFile,
          input.testFile.filePath,
          index + 1,
          input.selectedTests.length,
          input.progress,
          currentManifest,
        )
        if (result !== null) {
          currentManifest = result.manifest
          if (result.phase1Changed) anyPhase1Changed = true
        }
        return result
      }),
    ),
  )
  return { results, manifest: currentManifest, anyPhase1Changed }
}

function getSelectedTests(testFile: ParsedTestFile, selectedTestKeys: ReadonlySet<string>): readonly TestCase[] {
  return testFile.tests.filter((testCase) => selectedTestKeys.has(`${testFile.filePath}::${testCase.fullPath}`))
}

function collectValidBehaviors(
  results: readonly ({
    readonly behavior: ExtractedBehavior
    readonly manifest: IncrementalManifest
    readonly phase1Changed: boolean
  } | null)[],
): readonly ExtractedBehavior[] {
  return results
    .filter(
      (result): result is {
        readonly behavior: ExtractedBehavior
        readonly manifest: IncrementalManifest
        readonly phase1Changed: boolean
      } =>
        result !== null,
    )
    .map((result) => result.behavior)
}

async function processTestFile(
  testFile: ParsedTestFile,
  progress: Progress,
  fileIndex: number,
  totalFiles: number,
  selectedTestKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
): Promise<{ readonly manifest: IncrementalManifest; readonly anyPhase1Changed: boolean }> {
  if (progress.phase1.completedFiles.includes(testFile.filePath)) {
    console.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath} (skipped, already done)`)
    return { manifest, anyPhase1Changed: false }
  }
  console.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath}`)
  const selectedTests = getSelectedTests(testFile, selectedTestKeys)
  const extractionResult = await runSelectedExtractions({
    selectedTests,
    testFile,
    progress,
    manifest,
  })
  const valid = collectValidBehaviors(extractionResult.results)
  if (valid.length > 0) {
    await writeBehaviorFile(testFile.filePath, valid)
    console.log(`  → wrote ${valid.length} behaviors`)
  }
  markFileDone(progress, testFile.filePath)
  await saveProgress(progress)
  return { manifest: extractionResult.manifest, anyPhase1Changed: extractionResult.anyPhase1Changed }
}

export async function runPhase1({ testFiles, progress, selectedTestKeys, manifest }: Phase1RunInput): Promise<void> {
  progress.phase1.status = 'in-progress'
  await saveProgress(progress)
  const limit = pLimit(1)
  let currentManifest = manifest
  let anyPhase1Changed = false
  await Promise.all(
    testFiles.map((f, i) =>
      limit(async () => {
        const result = await processTestFile(f, progress, i + 1, testFiles.length, selectedTestKeys, currentManifest)
        currentManifest = result.manifest
        if (result.anyPhase1Changed) anyPhase1Changed = true
      }),
    ),
  )
  if (anyPhase1Changed) {
    resetPhase2AndPhase3(progress)
  }
  progress.phase1.status = 'done'
  await saveProgress(progress)
  console.log(
    `\n[Phase 1 complete] ${progress.phase1.stats.filesDone} files, ${progress.phase1.stats.testsExtracted} behaviors extracted, ${progress.phase1.stats.testsFailed} failed`,
  )
}
