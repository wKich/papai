import { markFileDone } from './progress.js'
import type { Progress } from './progress.js'
import type { ExtractedBehavior } from './report-writer.js'
import { writeBehaviorFile } from './report-writer.js'
import type { TestCase } from './test-parser.js'

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
  results: readonly ({ readonly behavior: ExtractedBehavior } | null)[],
): readonly ExtractedBehavior[] {
  return results
    .filter((result): result is { readonly behavior: ExtractedBehavior } => result !== null)
    .map((result) => result.behavior)
}

export async function writeValidBehaviorsForFile(
  testFilePath: string,
  results: readonly ({ readonly behavior: ExtractedBehavior } | null)[],
): Promise<void> {
  const valid = collectValidBehaviors(results)
  if (valid.length === 0) {
    return
  }
  await writeBehaviorFile(testFilePath, valid)
  console.log(`  → wrote ${valid.length} behaviors`)
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
