import { MAX_RETRIES } from './config.js'
import { buildBehaviorRecord } from './extract-phase1-helpers.js'
import type { Phase1RunnerDeps, SingleTestResult } from './extract-phase1-types.js'
import { buildExtractionPrompt } from './extract-prompts.js'
import { emitPhase1ItemStart, reportPhase1Failure, reportPhase1Skipped } from './extract-reporting.js'
import type { IncrementalManifest } from './incremental.js'
import { normalizeKeywordSlug } from './keyword-vocabulary.js'
import type { AgentUsage } from './phase-stats.js'
import type { Progress } from './progress.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'

export type ExtractionAttemptResult =
  | {
      readonly kind: 'failed'
      readonly detail: string
    }
  | {
      readonly kind: 'succeeded'
      readonly result: NonNullable<SingleTestResult>
    }

export function toTestKey(testFilePath: string, testCase: TestCase): string {
  return `${testFilePath}::${testCase.fullPath}`
}

function normalizeKeywords(keywords: readonly string[]): readonly string[] {
  return [...new Set(keywords.map((keyword) => normalizeKeywordSlug(keyword)).filter(Boolean))]
}

function buildSuccessfulTestResult(input: {
  readonly testCase: TestCase
  readonly testFile: ParsedTestFile
  readonly testKey: string
  readonly extracted: {
    readonly result: {
      readonly behavior: string
      readonly context: string
      readonly keywords: readonly string[]
    }
    readonly usage: AgentUsage
  }
  readonly manifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
  readonly startedAtMs: number
}): Promise<ExtractionAttemptResult> {
  const normalizedKeywords = normalizeKeywords(input.extracted.result.keywords)
  if (normalizedKeywords.length === 0) {
    throw new Error('Expected normalized keywords before building successful result')
  }

  const record = buildBehaviorRecord(
    input.testCase,
    input.testFile.filePath,
    input.testKey,
    input.extracted.result.behavior,
    input.extracted.result.context,
    normalizedKeywords,
  )
  return input.deps
    .updateManifestForExtractedTest({
      manifest: input.manifest,
      testFile: input.testFile,
      testCase: input.testCase,
      extractedBehavior: record,
    })
    .then(({ manifest, phase1Changed }) => ({
      kind: 'succeeded' as const,
      result: {
        record,
        manifest,
        phase1Changed,
        usage: input.extracted.usage,
        elapsedMs: performance.now() - input.startedAtMs,
      },
    }))
}

function runExtractionFailure(input: {
  readonly deps: Phase1RunnerDeps
  readonly progress: Progress
  readonly testKey: string
  readonly detail: string
}): ExtractionAttemptResult {
  input.deps.markTestFailed(input.progress, input.testKey, input.detail)
  return {
    kind: 'failed',
    detail: input.detail,
  }
}

function toFailureOrKeywords(input: {
  readonly deps: Phase1RunnerDeps
  readonly progress: Progress
  readonly testKey: string
  readonly keywords: readonly string[]
}):
  | { readonly kind: 'failed'; readonly failure: ExtractionAttemptResult }
  | { readonly kind: 'succeeded'; readonly keywords: readonly string[] } {
  const normalizedKeywords = normalizeKeywords(input.keywords)
  if (normalizedKeywords.length === 0) {
    return {
      kind: 'failed' as const,
      failure: runExtractionFailure({
        deps: input.deps,
        progress: input.progress,
        testKey: input.testKey,
        detail: 'extraction produced no valid canonical keywords',
      }),
    }
  }

  return {
    kind: 'succeeded',
    keywords: normalizedKeywords,
  }
}

export function beginSingleTest(input: {
  readonly deps: Phase1RunnerDeps
  readonly progress: Progress
  readonly testCase: TestCase
  readonly testFilePath: string
  readonly displayIndex: number
  readonly totalTests: number
}): { readonly testKey: string } | null {
  const testKey = toTestKey(input.testFilePath, input.testCase)
  emitPhase1ItemStart({
    deps: input.deps,
    itemId: testKey,
    context: input.testFilePath,
    title: input.testCase.name,
    index: input.displayIndex,
    total: input.totalTests,
  })

  if (input.deps.getFailedTestAttempts(input.progress, testKey) < MAX_RETRIES) {
    return { testKey }
  }

  reportPhase1Skipped({
    deps: input.deps,
    itemId: testKey,
    context: input.testFilePath,
    title: input.testCase.name,
    index: input.displayIndex,
    total: input.totalTests,
  })
  return null
}

export function emitSingleTestFailure(input: {
  readonly deps: Phase1RunnerDeps
  readonly testKey: string
  readonly testFilePath: string
  readonly title: string
  readonly displayIndex: number
  readonly totalTests: number
  readonly detail: string
}): null {
  reportPhase1Failure({
    deps: input.deps,
    itemId: input.testKey,
    context: input.testFilePath,
    title: input.title,
    index: input.displayIndex,
    total: input.totalTests,
    detail: input.detail,
    usage: undefined,
  })
  return null
}

export async function tryExtractTest(input: {
  readonly testCase: TestCase
  readonly testFile: ParsedTestFile
  readonly testKey: string
  readonly progress: Progress
  readonly manifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
}): Promise<ExtractionAttemptResult> {
  const startedAtMs = performance.now()
  const extracted = await input.deps.extractWithRetry(buildExtractionPrompt(input.testCase, input.testFile.filePath), 0)
  if (extracted === null) {
    return runExtractionFailure({
      deps: input.deps,
      progress: input.progress,
      testKey: input.testKey,
      detail: 'extraction failed',
    })
  }

  const normalized = toFailureOrKeywords({
    deps: input.deps,
    progress: input.progress,
    testKey: input.testKey,
    keywords: extracted.result.keywords,
  })
  if (normalized.kind === 'failed') {
    return normalized.failure
  }

  return buildSuccessfulTestResult({
    testCase: input.testCase,
    testFile: input.testFile,
    testKey: input.testKey,
    extracted: {
      result: {
        behavior: extracted.result.behavior,
        context: extracted.result.context,
        keywords: normalized.keywords,
      },
      usage: extracted.usage,
    },
    manifest: input.manifest,
    deps: input.deps,
    startedAtMs,
  })
}

export async function processSingleTestCase(input: {
  readonly testCase: TestCase
  readonly testFile: ParsedTestFile
  readonly displayIndex: number
  readonly totalTests: number
  readonly progress: Progress
  readonly manifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
}): Promise<SingleTestResult> {
  const started = beginSingleTest({
    deps: input.deps,
    progress: input.progress,
    testCase: input.testCase,
    testFilePath: input.testFile.filePath,
    displayIndex: input.displayIndex,
    totalTests: input.totalTests,
  })
  if (started === null) {
    return null
  }

  const extraction = await tryExtractTest({
    testCase: input.testCase,
    testFile: input.testFile,
    testKey: started.testKey,
    progress: input.progress,
    manifest: input.manifest,
    deps: input.deps,
  })
  if (extraction.kind === 'failed') {
    return emitSingleTestFailure({
      deps: input.deps,
      testKey: started.testKey,
      testFilePath: input.testFile.filePath,
      title: input.testCase.name,
      displayIndex: input.displayIndex,
      totalTests: input.totalTests,
      detail: extraction.detail,
    })
  }

  return extraction.result
}
