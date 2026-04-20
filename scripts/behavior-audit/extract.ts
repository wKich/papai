import pLimit from 'p-limit'

import { MAX_RETRIES } from './config.js'
import { extractWithRetry } from './extract-agent.js'
import { updateManifestForExtractedTest } from './extract-incremental.js'
import type { IncrementalManifest } from './incremental.js'
import { saveManifest } from './incremental.js'
import { resolveKeywordsWithRetry } from './keyword-resolver-agent.js'
import { loadKeywordVocabulary, recordKeywordUsage, saveKeywordVocabulary } from './keyword-vocabulary.js'
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

interface Phase1RunInput {
  readonly testFiles: readonly ParsedTestFile[]
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
}

function deriveImplPath(testPath: string): string {
  return testPath.replace(/^tests\//, 'src/').replace(/\.test\.ts$/, '.ts')
}

function buildExtractionPrompt(testCase: TestCase, testFilePath: string): string {
  const implPath = deriveImplPath(testFilePath)
  return `**Test file:** ${testFilePath}\n**Test name:** ${testCase.fullPath}\n**Likely implementation file:** ${implPath}\n\n\`\`\`typescript\n${testCase.source}\n\`\`\``
}

function buildResolverPrompt(candidateKeywords: readonly string[], vocabularyText: string): string {
  return [
    'Resolve the candidate keywords against the existing vocabulary.',
    'Reuse existing slugs when semantically appropriate.',
    'Append new entries only when no vocabulary slug adequately fits.',
    '',
    `Candidate keywords: ${candidateKeywords.join(', ')}`,
    '',
    'Existing vocabulary:',
    vocabularyText,
  ].join('\n')
}

async function resolveKeywords(
  candidateKeywords: readonly string[],
  testKey: string,
  progress: Progress,
): Promise<readonly string[] | null> {
  const existingVocabulary = (await loadKeywordVocabulary()) ?? []
  const vocabularyText = existingVocabulary.length === 0 ? '(empty)' : JSON.stringify(existingVocabulary, null, 2)
  const resolved = await resolveKeywordsWithRetry(buildResolverPrompt(candidateKeywords, vocabularyText), 0)
  if (resolved === null) {
    markTestFailed(progress, testKey, 'keyword resolution failed')
    return null
  }
  const nextVocabulary = [...existingVocabulary, ...resolved.appendedEntries]
  await saveKeywordVocabulary(nextVocabulary)
  await recordKeywordUsage(resolved.keywords)
  return resolved.keywords
}

type SingleTestResult = {
  readonly behavior: ExtractedBehavior
  readonly manifest: IncrementalManifest
  readonly phase1Changed: boolean
} | null

async function extractAndSave(
  testCase: TestCase,
  testFile: ParsedTestFile,
  testFilePath: string,
  testKey: string,
  displayIndex: number,
  totalTests: number,
  progress: Progress,
  manifest: IncrementalManifest,
): Promise<SingleTestResult> {
  process.stdout.write(`  [${displayIndex}/${totalTests}] "${testCase.name}" `)
  const extracted = await extractWithRetry(buildExtractionPrompt(testCase, testFilePath), 0)
  if (extracted === null) {
    markTestFailed(progress, testKey, 'extraction failed')
    return null
  }
  const keywords = await resolveKeywords(extracted.candidateKeywords, testKey, progress)
  if (keywords === null) return null
  const behavior: ExtractedBehavior = {
    testName: testCase.name,
    fullPath: testCase.fullPath,
    behavior: extracted.behavior,
    context: extracted.context,
    keywords,
  }
  markTestDone(progress, testFilePath, testKey, behavior)
  const { manifest: updatedManifest, phase1Changed } = await updateManifestForExtractedTest({
    manifest,
    testFile,
    testCase,
    extractedBehavior: behavior,
  })
  await saveManifest(updatedManifest)
  console.log(`    ✓`)
  return { behavior, manifest: updatedManifest, phase1Changed }
}

function processSingleTestCase(
  testCase: TestCase,
  testFile: ParsedTestFile,
  testFilePath: string,
  displayIndex: number,
  totalTests: number,
  progress: Progress,
  manifest: IncrementalManifest,
): Promise<SingleTestResult> {
  const testKey = `${testFilePath}::${testCase.fullPath}`
  const existing = progress.phase1.extractedBehaviors[testKey]
  if (existing !== undefined) {
    return Promise.resolve({ behavior: existing, manifest, phase1Changed: false })
  }
  if (getFailedTestAttempts(progress, testKey) >= MAX_RETRIES) {
    console.log(`  [${displayIndex}/${totalTests}] "${testCase.name}" (skipped, max retries reached)`)
    return Promise.resolve(null)
  }
  return extractAndSave(testCase, testFile, testFilePath, testKey, displayIndex, totalTests, progress, manifest)
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
      (
        result,
      ): result is {
        readonly behavior: ExtractedBehavior
        readonly manifest: IncrementalManifest
        readonly phase1Changed: boolean
      } => result !== null,
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
