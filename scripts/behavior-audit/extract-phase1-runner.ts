import pLimit from 'p-limit'

import { emitPersistedResults, persistExtractedResults } from './extract-phase1-persist.js'
import { processSingleTestCase } from './extract-phase1-single-test.js'
import type { Phase1RunnerDeps, SingleTestResult } from './extract-phase1-types.js'
import type { IncrementalManifest } from './incremental.js'
import type { Progress } from './progress.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'

async function runSelectedExtractions(input: {
  readonly selectedTests: readonly TestCase[]
  readonly testFile: ParsedTestFile
  readonly progress: Progress
  readonly manifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
}): Promise<{
  readonly results: readonly SingleTestResult[]
  readonly manifest: IncrementalManifest
  readonly anyPhase1Changed: boolean
}> {
  let currentManifest = input.manifest
  let anyPhase1Changed = false
  const limit = pLimit(1)
  const results = await Promise.all(
    input.selectedTests.map((testCase, index) =>
      limit(async () => {
        const result = await processSingleTestCase({
          testCase,
          testFile: input.testFile,
          displayIndex: index + 1,
          totalTests: input.selectedTests.length,
          progress: input.progress,
          manifest: currentManifest,
          deps: input.deps,
        })
        if (result !== null) {
          currentManifest = result.manifest
          if (result.phase1Changed) {
            anyPhase1Changed = true
          }
        }
        return result
      }),
    ),
  )

  return { results, manifest: currentManifest, anyPhase1Changed }
}

export async function processSelectedTestFile(input: {
  readonly testFile: ParsedTestFile
  readonly progress: Progress
  readonly selectedTests: readonly TestCase[]
  readonly manifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
}): Promise<{ readonly manifest: IncrementalManifest; readonly anyPhase1Changed: boolean }> {
  const extractionResult = await runSelectedExtractions({
    selectedTests: input.selectedTests,
    testFile: input.testFile,
    progress: input.progress,
    manifest: input.manifest,
    deps: input.deps,
  })

  await persistExtractedResults({
    extractionResult,
    testFilePath: input.testFile.filePath,
    selectedTests: input.selectedTests,
    progress: input.progress,
    deps: input.deps,
  })
  emitPersistedResults({
    results: extractionResult.results,
    selectedTests: input.selectedTests,
    testFilePath: input.testFile.filePath,
    deps: input.deps,
  })

  return {
    manifest: extractionResult.manifest,
    anyPhase1Changed: extractionResult.anyPhase1Changed,
  }
}
