import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs } from 'ai'
import pLimit from 'p-limit'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE1_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import type { Progress } from './progress.js'
import { getFailedTestAttempts, markFileDone, markTestDone, markTestFailed, saveProgress } from './progress.js'
import type { ExtractedBehavior } from './report-writer.js'
import { writeBehaviorFile } from './report-writer.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'
import { makeAuditTools } from './tools.js'

const apiKey = process.env['OPENAI_API_KEY'] ?? 'no-key'
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
    const toolCallCount = result.steps.reduce((sum, s) => sum + (s.toolCalls?.length ?? 0), 0)
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
  testFilePath: string,
  displayIndex: number,
  totalTests: number,
  progress: Progress,
): Promise<ExtractedBehavior | null> {
  const testKey = `${testFilePath}::${testCase.fullPath}`
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
  markTestDone(progress, testFilePath, testKey)
  return {
    testName: testCase.name,
    fullPath: testCase.fullPath,
    behavior: extracted.behavior,
    context: extracted.context,
  }
}

async function processTestFile(
  testFile: ParsedTestFile,
  progress: Progress,
  fileIndex: number,
  totalFiles: number,
): Promise<void> {
  if (progress.phase1.completedFiles.includes(testFile.filePath)) {
    console.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath} (skipped, already done)`)
    return
  }
  console.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath}`)
  const limit = pLimit(1)
  const behaviors = await Promise.all(
    testFile.tests.map((tc, i) =>
      limit(() => processSingleTestCase(tc, testFile.filePath, i + 1, testFile.tests.length, progress)),
    ),
  )
  const valid = behaviors.filter((b): b is ExtractedBehavior => b !== null)
  if (valid.length > 0) {
    await writeBehaviorFile(testFile.filePath, valid)
    console.log(`  → wrote ${valid.length} behaviors`)
  }
  markFileDone(progress, testFile.filePath)
  await saveProgress(progress)
}

export async function runPhase1(testFiles: readonly ParsedTestFile[], progress: Progress): Promise<void> {
  progress.phase1.status = 'in-progress'
  await saveProgress(progress)
  const limit = pLimit(1)
  await Promise.all(testFiles.map((f, i) => limit(() => processTestFile(f, progress, i + 1, testFiles.length))))
  progress.phase1.status = 'done'
  await saveProgress(progress)
  console.log(
    `\n[Phase 1 complete] ${progress.phase1.stats.filesDone} files, ${progress.phase1.stats.testsExtracted} behaviors extracted, ${progress.phase1.stats.testsFailed} failed`,
  )
}
