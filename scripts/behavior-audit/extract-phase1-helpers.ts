import { extractedArtifactPathForTestFile } from './artifact-paths.js'
import { buildResolverPrompt, buildVocabularySlugListText } from './extract-prompts.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import { readExtractedFile, writeExtractedFile } from './extracted-store.js'
import { resolveKeywordsWithRetry } from './keyword-resolver-agent.js'
import {
  loadKeywordVocabulary,
  normalizeKeywordSlug,
  normalizeKeywordVocabularyEntries,
  saveKeywordVocabulary,
  stampVocabularyEntry,
} from './keyword-vocabulary.js'
import { markFileDone, markTestFailed } from './progress.js'
import type { Progress } from './progress.js'
import type { TestCase } from './test-parser.js'

export interface ResolveKeywordsDeps {
  readonly loadKeywordVocabulary: typeof loadKeywordVocabulary
  readonly saveKeywordVocabulary: typeof saveKeywordVocabulary
  readonly resolveKeywordsWithRetry: typeof resolveKeywordsWithRetry
  readonly markTestFailed: typeof markTestFailed
}

export async function resolveKeywords(
  candidateKeywords: readonly string[],
  testKey: string,
  progress: Progress,
  deps: ResolveKeywordsDeps,
): Promise<readonly string[] | null> {
  const existingVocabulary = (await deps.loadKeywordVocabulary()) ?? []
  const vocabularyText = buildVocabularySlugListText(existingVocabulary)
  const resolved = await deps.resolveKeywordsWithRetry(buildResolverPrompt(candidateKeywords, vocabularyText), 0)
  if (resolved === null) {
    deps.markTestFailed(progress, testKey, 'keyword resolution failed')
    return null
  }
  const nextVocabulary = normalizeKeywordVocabularyEntries([
    ...existingVocabulary,
    ...resolved.appendedEntries.map((entry) => stampVocabularyEntry(entry)),
  ])
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

export function getSelectedTests(
  testFilePath: string,
  tests: readonly TestCase[],
  selectedTestKeys: ReadonlySet<string>,
): readonly TestCase[] {
  return tests.filter((testCase) => selectedTestKeys.has(`${testFilePath}::${testCase.fullPath}`))
}

function getCompletedTestsForFile(progress: Progress, testFilePath: string): Readonly<Record<string, 'done'>> {
  const completedTestsForFile = progress.phase1.completedTests[testFilePath]
  if (completedTestsForFile === undefined) {
    return {}
  }
  return completedTestsForFile
}

function getSelectedTestKeySet(testFilePath: string, selectedTests: readonly TestCase[]): ReadonlySet<string> {
  return new Set(selectedTests.map((testCase) => `${testFilePath}::${testCase.fullPath}`))
}

function removeCompletedFile(progress: Progress, testFilePath: string): void {
  const hadCompletedFile = progress.phase1.completedFiles.includes(testFilePath)
  progress.phase1.completedFiles = progress.phase1.completedFiles.filter((filePath) => filePath !== testFilePath)
  if (hadCompletedFile) {
    progress.phase1.stats.filesDone = Math.max(0, progress.phase1.stats.filesDone - 1)
  }
}

async function deleteFileIfPresent(filePath: string): Promise<void> {
  const file = Bun.file(filePath)
  if (await file.exists()) {
    await file.delete()
  }
}

function areSelectedTestsDone(
  testFilePath: string,
  selectedTests: readonly TestCase[],
  completedTests: Readonly<Record<string, 'done'>>,
): boolean {
  return selectedTests.every((testCase) => completedTests[`${testFilePath}::${testCase.fullPath}`] === 'done')
}

export function shouldSkipCompletedFile(input: {
  readonly progress: Progress
  readonly testFilePath: string
  readonly selectedTests: readonly TestCase[]
  readonly selectedTestKeys: ReadonlySet<string>
}): boolean {
  if (input.selectedTestKeys.size > 0 || !input.progress.phase1.completedFiles.includes(input.testFilePath)) {
    return false
  }
  return areSelectedTestsDone(
    input.testFilePath,
    input.selectedTests,
    getCompletedTestsForFile(input.progress, input.testFilePath),
  )
}

export function collectValidBehaviors(
  results: readonly ({ readonly record: ExtractedBehaviorRecord } | null)[],
): readonly ExtractedBehaviorRecord[] {
  return results
    .filter((result): result is { readonly record: ExtractedBehaviorRecord } => result !== null)
    .map((result) => result.record)
}

export async function writeValidBehaviorsForFile(
  testFilePath: string,
  selectedTests: readonly TestCase[],
  results: readonly ({ readonly record: ExtractedBehaviorRecord } | null)[],
): Promise<void> {
  const valid = collectValidBehaviors(results)
  const existing = (await readExtractedFile(testFilePath)) ?? []
  const selectedTestKeySet = getSelectedTestKeySet(testFilePath, selectedTests)
  const merged = [
    ...existing.filter(
      (record) => !selectedTestKeySet.has(record.testKey) && !selectedTestKeySet.has(record.behaviorId),
    ),
    ...valid,
  ]
  if (merged.length === 0) {
    await deleteFileIfPresent(extractedArtifactPathForTestFile(testFilePath))
    return
  }
  await writeExtractedFile(testFilePath, merged)
  console.log(`  → wrote ${valid.length} behaviors`)
}

export function reconcileSelectedTestsAfterPersist(
  progress: Progress,
  testFilePath: string,
  selectedTests: readonly TestCase[],
  persistedTestKeys: ReadonlySet<string>,
): void {
  const selectedTestKeySet = getSelectedTestKeySet(testFilePath, selectedTests)
  const completedTestsForFile = getCompletedTestsForFile(progress, testFilePath)
  const nextCompletedEntries = Object.entries(completedTestsForFile).filter(([testKey]) => {
    const shouldKeep = !selectedTestKeySet.has(testKey) || persistedTestKeys.has(testKey)
    if (!shouldKeep && completedTestsForFile[testKey] === 'done') {
      progress.phase1.stats.testsExtracted = Math.max(0, progress.phase1.stats.testsExtracted - 1)
    }
    return shouldKeep
  })

  progress.phase1.completedTests =
    nextCompletedEntries.length === 0
      ? Object.fromEntries(
          Object.entries(progress.phase1.completedTests).filter(([filePath]) => filePath !== testFilePath),
        )
      : {
          ...progress.phase1.completedTests,
          [testFilePath]: Object.fromEntries(nextCompletedEntries),
        }

  const hasMissingSelectedPersistence = [...selectedTestKeySet].some((testKey) => !persistedTestKeys.has(testKey))
  if (hasMissingSelectedPersistence) {
    removeCompletedFile(progress, testFilePath)
  }
}

export function markFileDoneWhenSelectedTestsPersisted(
  progress: Progress,
  testFilePath: string,
  selectedTests: readonly TestCase[],
): void {
  const selectedTestKeySet = getSelectedTestKeySet(testFilePath, selectedTests)
  const completedTests = getCompletedTestsForFile(progress, testFilePath)
  const allSelectedTestsPersisted = [...selectedTestKeySet].every((testKey) => completedTests[testKey] === 'done')
  if (allSelectedTestsPersisted) {
    markFileDone(progress, testFilePath)
  }
}
