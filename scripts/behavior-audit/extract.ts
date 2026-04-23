import pLimit from 'p-limit'

import { MAX_RETRIES } from './config.js'
import { getDomain } from './domain-map.js'
import { extractWithRetry } from './extract-agent.js'
import { updateManifestForExtractedTest } from './extract-incremental.js'
import {
  getSelectedTests,
  markFileDoneWhenSelectedTestsPersisted,
  reconcileSelectedTestsAfterPersist,
  shouldSkipCompletedFile,
  writeValidBehaviorsForFile,
} from './extract-phase1-helpers.js'
import { buildExtractionPrompt, buildResolverPrompt, buildVocabularySlugListText } from './extract-prompts.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import type { IncrementalManifest } from './incremental.js'
import { saveManifest } from './incremental.js'
import { resolveKeywordsWithRetry } from './keyword-resolver-agent.js'
import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'
import {
  loadKeywordVocabulary,
  normalizeKeywordSlug,
  normalizeKeywordVocabularyEntries,
  saveKeywordVocabulary,
} from './keyword-vocabulary.js'
import type { Progress } from './progress.js'
import { getFailedTestAttempts, markTestDone, markTestFailed, resetPhase2AndPhase3, saveProgress } from './progress.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'

interface Phase1RunInput {
  readonly testFiles: readonly ParsedTestFile[]
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
}

export interface Phase1Deps {
  readonly extractWithRetry: typeof extractWithRetry
  readonly resolveKeywordsWithRetry: typeof resolveKeywordsWithRetry
  readonly loadKeywordVocabulary: typeof loadKeywordVocabulary
  readonly saveKeywordVocabulary: typeof saveKeywordVocabulary
  readonly updateManifestForExtractedTest: typeof updateManifestForExtractedTest
  readonly saveManifest: typeof saveManifest
  readonly saveProgress: typeof saveProgress
  readonly getFailedTestAttempts: typeof getFailedTestAttempts
  readonly markTestDone: typeof markTestDone
  readonly markTestFailed: typeof markTestFailed
  readonly resetPhase2AndPhase3: typeof resetPhase2AndPhase3
  readonly getSelectedTests: typeof getSelectedTests
  readonly shouldSkipCompletedFile: typeof shouldSkipCompletedFile
  readonly writeValidBehaviorsForFile: typeof writeValidBehaviorsForFile
  readonly markFileDoneWhenSelectedTestsPersisted: typeof markFileDoneWhenSelectedTestsPersisted
  readonly log: Pick<typeof console, 'log'>
  readonly writeStdout: (text: string) => void
}

const defaultPhase1Deps: Phase1Deps = {
  extractWithRetry,
  resolveKeywordsWithRetry,
  loadKeywordVocabulary,
  saveKeywordVocabulary,
  updateManifestForExtractedTest,
  saveManifest,
  saveProgress,
  getFailedTestAttempts,
  markTestDone,
  markTestFailed,
  resetPhase2AndPhase3,
  getSelectedTests,
  shouldSkipCompletedFile,
  writeValidBehaviorsForFile,
  markFileDoneWhenSelectedTestsPersisted,
  log: console,
  writeStdout: (text) => {
    process.stdout.write(text)
  },
}

async function resolveKeywords(
  candidateKeywords: readonly string[],
  testKey: string,
  progress: Progress,
  deps: Phase1Deps,
): Promise<readonly string[] | null> {
  const loadedVocabulary = await deps.loadKeywordVocabulary()
  let existingVocabulary: readonly KeywordVocabularyEntry[] = []
  if (loadedVocabulary !== null) {
    existingVocabulary = loadedVocabulary
  }
  const vocabularyText = buildVocabularySlugListText(existingVocabulary)
  const resolved = await deps.resolveKeywordsWithRetry(buildResolverPrompt(candidateKeywords, vocabularyText), 0)
  if (resolved === null) {
    deps.markTestFailed(progress, testKey, 'keyword resolution failed')
    return null
  }
  const nextVocabulary = normalizeKeywordVocabularyEntries([...existingVocabulary, ...resolved.appendedEntries])
  await deps.saveKeywordVocabulary(nextVocabulary)
  const normalizedKeywords = [
    ...new Set(resolved.keywords.map((keyword) => normalizeKeywordSlug(keyword)).filter(Boolean)),
  ]
  if (normalizedKeywords.length === 0) {
    deps.markTestFailed(progress, testKey, 'keyword resolution produced no valid canonical keywords')
    return null
  }
  return normalizedKeywords
}

type SingleTestResult = {
  readonly record: ExtractedBehaviorRecord
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
  deps: Phase1Deps,
): Promise<SingleTestResult> {
  deps.writeStdout(`  [${displayIndex}/${totalTests}] "${testCase.name}" `)
  const extracted = await deps.extractWithRetry(buildExtractionPrompt(testCase, testFilePath), 0)
  if (extracted === null) {
    deps.markTestFailed(progress, testKey, 'extraction failed')
    return null
  }
  const keywords = await resolveKeywords(extracted.candidateKeywords, testKey, progress, deps)
  if (keywords === null) return null
  const record: ExtractedBehaviorRecord = {
    behaviorId: testKey,
    testKey,
    testFile: testFilePath,
    domain: getDomain(testFilePath),
    testName: testCase.name,
    fullPath: testCase.fullPath,
    behavior: extracted.behavior,
    context: extracted.context,
    keywords,
    extractedAt: new Date().toISOString(),
  }
  const { manifest: updatedManifest, phase1Changed } = await deps.updateManifestForExtractedTest({
    manifest,
    testFile,
    testCase,
    extractedBehavior: record,
  })
  deps.log.log('    ✓')
  return { record, manifest: updatedManifest, phase1Changed }
}

function processSingleTestCase(
  testCase: TestCase,
  testFile: ParsedTestFile,
  testFilePath: string,
  displayIndex: number,
  totalTests: number,
  progress: Progress,
  manifest: IncrementalManifest,
  deps: Phase1Deps,
): Promise<SingleTestResult> {
  const testKey = `${testFilePath}::${testCase.fullPath}`
  const completedTestsForFile = progress.phase1.completedTests[testFilePath]
  const isSelectedRerun = completedTestsForFile !== undefined && completedTestsForFile[testKey] === 'done'
  void isSelectedRerun
  if (deps.getFailedTestAttempts(progress, testKey) >= MAX_RETRIES) {
    deps.log.log(`  [${displayIndex}/${totalTests}] "${testCase.name}" (skipped, max retries reached)`)
    return Promise.resolve(null)
  }
  return extractAndSave(testCase, testFile, testFilePath, testKey, displayIndex, totalTests, progress, manifest, deps)
}

async function runSelectedExtractions(input: {
  readonly selectedTests: readonly TestCase[]
  readonly testFile: ParsedTestFile
  readonly progress: Progress
  readonly manifest: IncrementalManifest
  readonly deps: Phase1Deps
}): Promise<{
  readonly results: readonly ({
    readonly record: ExtractedBehaviorRecord
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
          input.deps,
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

async function processTestFile(
  testFile: ParsedTestFile,
  progress: Progress,
  fileIndex: number,
  totalFiles: number,
  selectedTestKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
  deps: Phase1Deps,
): Promise<{ readonly manifest: IncrementalManifest; readonly anyPhase1Changed: boolean }> {
  const selectedTests = deps.getSelectedTests(testFile.filePath, testFile.tests, selectedTestKeys)
  if (selectedTests.length === 0) {
    deps.log.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath} (skipped, no selected tests)`)
    return { manifest, anyPhase1Changed: false }
  }
  if (deps.shouldSkipCompletedFile({ progress, testFilePath: testFile.filePath, selectedTests, selectedTestKeys })) {
    deps.log.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath} (skipped, already done)`)
    return { manifest, anyPhase1Changed: false }
  }
  deps.log.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath}`)
  const extractionResult = await runSelectedExtractions({
    selectedTests,
    testFile,
    progress,
    manifest,
    deps,
  })
  await deps.writeValidBehaviorsForFile(testFile.filePath, selectedTests, extractionResult.results)
  const persistedTestKeys = new Set(
    extractionResult.results.flatMap((result) => (result === null ? [] : [result.record.testKey])),
  )
  reconcileSelectedTestsAfterPersist(progress, testFile.filePath, selectedTests, persistedTestKeys)
  for (const testKey of persistedTestKeys) {
    deps.markTestDone(progress, testFile.filePath, testKey)
  }
  await deps.saveManifest(extractionResult.manifest)
  deps.markFileDoneWhenSelectedTestsPersisted(progress, testFile.filePath, selectedTests)
  await deps.saveProgress(progress)
  return { manifest: extractionResult.manifest, anyPhase1Changed: extractionResult.anyPhase1Changed }
}

export async function runPhase1(
  { testFiles, progress, selectedTestKeys, manifest }: Phase1RunInput,
  deps: Partial<Phase1Deps> = {},
): Promise<void> {
  const resolvedDeps: Phase1Deps = { ...defaultPhase1Deps, ...deps }
  const hasSelectedPhase1Work = testFiles.some(
    (testFile) => resolvedDeps.getSelectedTests(testFile.filePath, testFile.tests, selectedTestKeys).length > 0,
  )
  if (hasSelectedPhase1Work) {
    resolvedDeps.resetPhase2AndPhase3(progress)
  }
  progress.phase1.status = 'in-progress'
  await resolvedDeps.saveProgress(progress)
  const limit = pLimit(1)
  let currentManifest = manifest
  let anyPhase1Changed = false
  await Promise.all(
    testFiles.map((f, i) =>
      limit(async () => {
        const result = await processTestFile(
          f,
          progress,
          i + 1,
          testFiles.length,
          selectedTestKeys,
          currentManifest,
          resolvedDeps,
        )
        currentManifest = result.manifest
        if (result.anyPhase1Changed) anyPhase1Changed = true
      }),
    ),
  )
  if (anyPhase1Changed && !hasSelectedPhase1Work) {
    resolvedDeps.resetPhase2AndPhase3(progress)
  }
  progress.phase1.status = 'done'
  await resolvedDeps.saveProgress(progress)
  resolvedDeps.log.log(
    `\n[Phase 1 complete] ${progress.phase1.stats.filesDone} files, ${progress.phase1.stats.testsExtracted} behaviors extracted, ${progress.phase1.stats.testsFailed} failed`,
  )
}
