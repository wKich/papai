import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { IncrementalManifest, IncrementalSelection } from '../../scripts/behavior-audit/incremental.js'
import type * as IncrementalModule from '../../scripts/behavior-audit/incremental.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import type { ParsedTestFile } from '../../scripts/behavior-audit/test-parser.js'
import {
  createEmptyProgressFixture,
  createExtractedBehaviorFixture,
  createIncrementalManifestFixture,
  createManifestTestEntry,
  mockReportsConfig,
  writeWorkspaceFile,
} from './behavior-audit-integration.helpers.js'
import {
  cleanupTempDirs,
  commitAll,
  initializeGitRepo,
  makeTempDir,
  originalOpenAiApiKey,
  originalProcessExit,
  resolveExitCode,
  restoreOpenAiApiKey,
  runCommand,
} from './behavior-audit-integration.runtime-helpers.js'
import {
  createEmptyManifest,
  type CaptureRunStartResult,
  getArrayItem,
  getManifestEntry,
  getParsedTestKeys,
  type IncrementalModuleShape,
  isObject,
  isReportWriterModule,
  loadBehaviorAuditEntryPoint,
  loadClassifyAgentModule,
  loadExtractModule,
  loadIncrementalModule,
  loadProgressModule,
  loadReportWriterModule,
  type MockClassificationResult,
  normalizePhase1Call,
  normalizePhase2Call,
  readSavedManifest,
  resolveNullableManifest,
  type SelectIncrementalWorkInput,
} from './behavior-audit-integration.support.js'

function createEmptyProgress(filesTotal: number): Progress {
  return createEmptyProgressFixture(filesTotal)
}

function isCallableTimerHandler(value: TimerHandler): value is (...args: unknown[]) => void {
  return typeof value === 'function'
}

beforeEach(() => {
  if (originalOpenAiApiKey === undefined) {
    process.env['OPENAI_API_KEY'] = 'test-openai-api-key'
    return
  }
  process.env['OPENAI_API_KEY'] = originalOpenAiApiKey
})

afterEach(() => {
  restoreOpenAiApiKey()
  cleanupTempDirs()
})

describe('behavior-audit entrypoint incremental selection', () => {
  let root: string
  let reportsDir: string
  let manifestPath: string
  let progressPath: string
  let consolidatedManifestPath: string
  let loadManifestImpl: () => Promise<IncrementalManifest | null>
  let loadConsolidatedManifestImpl: () => Promise<IncrementalModule.ConsolidatedManifest | null>
  let captureRunStartImpl: (
    manifest: IncrementalManifest,
    currentHead: string,
    startedAt: string,
  ) => { readonly previousLastStartCommit: string | null; readonly updatedManifest: IncrementalManifest }
  let saveManifestCalls: IncrementalManifest[]
  let saveConsolidatedManifestCalls: readonly IncrementalModule.ConsolidatedManifest[]
  let collectChangedFilesImpl: (previousLastStartCommit: string | null) => Promise<readonly string[]>
  let selectIncrementalWorkImpl: (input: {
    readonly changedFiles: readonly string[]
    readonly previousManifest: IncrementalManifest
    readonly currentPhaseVersions: IncrementalManifest['phaseVersions']
    readonly discoveredTestKeys: readonly string[]
    readonly previousConsolidatedManifest: IncrementalModule.ConsolidatedManifest | null
  }) => IncrementalSelection
  let selectIncrementalWorkCalls: readonly {
    readonly changedFiles: readonly string[]
    readonly previousManifest: IncrementalManifest
    readonly currentPhaseVersions: IncrementalManifest['phaseVersions']
    readonly discoveredTestKeys: readonly string[]
    readonly previousConsolidatedManifest: IncrementalModule.ConsolidatedManifest | null
  }[]
  let loadProgressImpl: () => Promise<Progress | null>
  let createEmptyProgressCalls: number[]
  let runPhase1Calls: readonly {
    readonly parsedTestKeys: readonly string[]
    readonly selectedTestKeys: readonly string[]
  }[]
  let runPhase2aCalls: readonly string[][]
  let runPhase2bCalls: readonly string[][]
  let phase3Calls: readonly { readonly selectedConsolidatedIds: readonly string[] }[]

  beforeEach(async () => {
    root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    progressPath = path.join(reportsDir, 'progress.json')
    consolidatedManifestPath = path.join(reportsDir, 'consolidated-manifest.json')
    loadManifestImpl = (): Promise<IncrementalManifest | null> => Promise.resolve(null)
    loadConsolidatedManifestImpl = (): Promise<IncrementalModule.ConsolidatedManifest | null> => Promise.resolve(null)
    captureRunStartImpl = (manifest, currentHead, startedAt): CaptureRunStartResult => ({
      previousLastStartCommit: manifest.lastStartCommit,
      updatedManifest: {
        ...manifest,
        lastStartCommit: currentHead,
        lastStartedAt: startedAt,
      },
    })
    saveManifestCalls = []
    saveConsolidatedManifestCalls = []
    collectChangedFilesImpl = (): Promise<readonly string[]> => Promise.resolve([])
    selectIncrementalWorkCalls = []
    selectIncrementalWorkImpl = (input: SelectIncrementalWorkInput): IncrementalSelection => {
      selectIncrementalWorkCalls = [...selectIncrementalWorkCalls, input]
      return {
        phase1SelectedTestKeys: [...input.discoveredTestKeys].toSorted(),
        phase2aSelectedTestKeys: [...input.discoveredTestKeys].toSorted(),
        phase2bSelectedCandidateFeatureKeys: [],
        phase3SelectedConsolidatedIds: [],
        reportRebuildOnly: false,
      }
    }
    loadProgressImpl = (): Promise<Progress | null> => Promise.resolve(null)
    createEmptyProgressCalls = []
    runPhase1Calls = []
    runPhase2aCalls = []
    runPhase2bCalls = []
    phase3Calls = []

    const testsDir = path.join(root, 'tests', 'tools')
    mkdirSync(testsDir, { recursive: true })
    writeWorkspaceFile(
      root,
      'tests/tools/sample.test.ts',
      ["describe('suite', () => {", "  test('first case', () => {})", "  test('second case', () => {})", '})', ''].join(
        '\n',
      ),
    )

    mockReportsConfig(root, {
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      CONSOLIDATED_MANIFEST_PATH: consolidatedManifestPath,
      PHASE2_TIMEOUT_MS: 300_000,
      RETRY_BACKOFF_MS: [100_000, 300_000, 900_000] as const,
    })
    const realIncrementalModule = await loadIncrementalModule(`entrypoint=${crypto.randomUUID()}`)
    void mock.module('../../scripts/behavior-audit/incremental.js', () => ({
      ...realIncrementalModule,
      createEmptyManifest,
      createEmptyConsolidatedManifest: (): IncrementalModule.ConsolidatedManifest => ({ version: 1, entries: {} }),
      loadManifest: (): Promise<IncrementalManifest | null> => loadManifestImpl(),
      loadConsolidatedManifest: (): Promise<IncrementalModule.ConsolidatedManifest | null> =>
        loadConsolidatedManifestImpl(),
      captureRunStart: (manifest: IncrementalManifest, currentHead: string, startedAt: string): CaptureRunStartResult =>
        captureRunStartImpl(manifest, currentHead, startedAt),
      saveManifest: (manifest: IncrementalManifest): Promise<void> => {
        saveManifestCalls = [...saveManifestCalls, manifest]
        return Promise.resolve()
      },
      saveConsolidatedManifest: (manifest: IncrementalModule.ConsolidatedManifest): Promise<void> => {
        saveConsolidatedManifestCalls = [...saveConsolidatedManifestCalls, manifest]
        return Promise.resolve()
      },
      collectChangedFiles: (previousLastStartCommit: string | null): Promise<readonly string[]> =>
        collectChangedFilesImpl(previousLastStartCommit),
      selectIncrementalWork: (input: SelectIncrementalWorkInput): IncrementalSelection =>
        selectIncrementalWorkImpl(input),
    }))
    const realProgressModule = await loadProgressModule(`entrypoint=${crypto.randomUUID()}`)
    void mock.module('../../scripts/behavior-audit/progress.js', () => ({
      ...realProgressModule,
      loadProgress: (): Promise<Progress | null> => loadProgressImpl(),
      createEmptyProgress: (filesTotal: number): Progress => {
        createEmptyProgressCalls = [...createEmptyProgressCalls, filesTotal]
        return createEmptyProgress(filesTotal)
      },
      saveProgress: (): Promise<void> => Promise.resolve(),
    }))
    void mock.module('../../scripts/behavior-audit/extract.js', () => ({
      runPhase1: (...args: readonly unknown[]): Promise<void> => {
        runPhase1Calls = [...runPhase1Calls, normalizePhase1Call(args)]
        return Promise.resolve()
      },
    }))
    void mock.module('../../scripts/behavior-audit/evaluate.js', () => ({
      runPhase3: (...args: readonly unknown[]): Promise<void> => {
        phase3Calls = [...phase3Calls, normalizePhase2Call(args)]
        return Promise.resolve()
      },
    }))
    void mock.module('../../scripts/behavior-audit/classify.js', () => ({
      runPhase2a: (input: { readonly selectedTestKeys: ReadonlySet<string> }): Promise<ReadonlySet<string>> => {
        runPhase2aCalls = [...runPhase2aCalls, [...input.selectedTestKeys].toSorted()]
        return Promise.resolve(new Set())
      },
    }))
    void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
      runPhase2b: (
        _progress: unknown,
        _manifest: IncrementalModule.ConsolidatedManifest,
        _phaseVersion: string,
        selectedCandidateFeatureKeys: ReadonlySet<string>,
      ): Promise<IncrementalModule.ConsolidatedManifest> => {
        runPhase2bCalls = [...runPhase2bCalls, [...selectedCandidateFeatureKeys].toSorted()]
        return Promise.resolve({ version: 1, entries: {} })
      },
    }))
  })

  test('main performs full selection when no manifest exists', async () => {
    await initializeGitRepo(root)

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    const expectedKeys = [
      'tests/tools/sample.test.ts::suite > first case',
      'tests/tools/sample.test.ts::suite > second case',
    ]

    expect(createEmptyProgressCalls).toEqual([1])
    expect(selectIncrementalWorkCalls).toHaveLength(1)
    expect(getArrayItem(selectIncrementalWorkCalls, 0).discoveredTestKeys).toEqual(expectedKeys)
    expect(runPhase1Calls).toEqual([{ parsedTestKeys: expectedKeys, selectedTestKeys: expectedKeys }])
    expect(runPhase2aCalls).toEqual([expectedKeys])
    expect(runPhase2bCalls).toEqual([[]])
    expect(phase3Calls).toEqual([{ selectedConsolidatedIds: [] }])
  })

  test('main fails fast when OPENAI_API_KEY is missing', async () => {
    await initializeGitRepo(root)

    const previousOpenAiApiKey = process.env['OPENAI_API_KEY']
    const consoleErrorSpy = mock(() => {})
    const processExitSpy = mock((code: number | undefined) => {
      throw new Error(`process.exit:${resolveExitCode(code)}`)
    })

    const originalConsoleError = console.error
    console.error = consoleErrorSpy as typeof console.error
    process.exit = processExitSpy as typeof process.exit
    delete process.env['OPENAI_API_KEY']

    try {
      await expect(loadBehaviorAuditEntryPoint(crypto.randomUUID())).rejects.toThrow('process.exit:1')
    } finally {
      console.error = originalConsoleError
      process.exit = originalProcessExit
      if (previousOpenAiApiKey === undefined) {
        delete process.env['OPENAI_API_KEY']
      } else {
        process.env['OPENAI_API_KEY'] = previousOpenAiApiKey
      }
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith('Fatal error:', 'Behavior audit requires OPENAI_API_KEY to be set')
    expect(runPhase1Calls).toHaveLength(0)
    expect(runPhase2aCalls).toHaveLength(0)
    expect(runPhase2bCalls).toHaveLength(0)
    expect(phase3Calls).toHaveLength(0)
  })

  test('main passes incremental selection through to both phases', async () => {
    await initializeGitRepo(root)

    const previousManifest = createIncrementalManifestFixture({
      lastStartCommit: 'previous-start',
      phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      tests: {
        'tests/tools/sample.test.ts::suite > first case': createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > first case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'fp1',
          phase2Fingerprint: 'fp2',
          extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: 'x',
          lastPhase2CompletedAt: 'y',
        }),
      },
    })
    const selectedKeys = ['tests/tools/sample.test.ts::suite > first case']
    loadManifestImpl = (): Promise<IncrementalManifest> => Promise.resolve(previousManifest)
    collectChangedFilesImpl = (): Promise<readonly string[]> => Promise.resolve(['tests/tools/sample.test.ts'])
    selectIncrementalWorkImpl = (input: SelectIncrementalWorkInput): IncrementalSelection => {
      selectIncrementalWorkCalls = [...selectIncrementalWorkCalls, input]
      return {
        phase1SelectedTestKeys: selectedKeys,
        phase2aSelectedTestKeys: selectedKeys,
        phase2bSelectedCandidateFeatureKeys: [],
        phase3SelectedConsolidatedIds: ['tools::selected-case'],
        reportRebuildOnly: false,
      }
    }

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    expect(selectIncrementalWorkCalls).toHaveLength(1)
    expect(getArrayItem(selectIncrementalWorkCalls, 0).changedFiles).toEqual(['tests/tools/sample.test.ts'])
    expect(getArrayItem(selectIncrementalWorkCalls, 0).previousManifest).toEqual(previousManifest)
    expect(runPhase1Calls).toEqual([
      {
        parsedTestKeys: [
          'tests/tools/sample.test.ts::suite > first case',
          'tests/tools/sample.test.ts::suite > second case',
        ],
        selectedTestKeys: selectedKeys,
      },
    ])
    expect(runPhase2aCalls).toEqual([selectedKeys])
    expect(runPhase2bCalls).toEqual([[]])
    expect(phase3Calls).toEqual([{ selectedConsolidatedIds: ['tools::selected-case'] }])
  })

  test('main reruns selected work even when prior phases are marked done', async () => {
    await initializeGitRepo(root)

    const selectedKey = 'tests/tools/sample.test.ts::suite > first case'
    loadProgressImpl = (): Promise<Progress> =>
      Promise.resolve({
        ...createEmptyProgress(1),
        phase1: {
          ...createEmptyProgress(1).phase1,
          status: 'done',
          completedFiles: ['tests/tools/sample.test.ts'],
        },
        phase2b: {
          ...createEmptyProgress(1).phase2b,
          status: 'done',
          completedCandidateFeatures: { 'group-targeting': 'done' },
        },
        phase3: {
          ...createEmptyProgress(1).phase3,
          status: 'done',
          completedBehaviors: { 'tools::selected-case': 'done' },
        },
      })
    selectIncrementalWorkImpl = (input: SelectIncrementalWorkInput): IncrementalSelection => {
      selectIncrementalWorkCalls = [...selectIncrementalWorkCalls, input]
      return {
        phase1SelectedTestKeys: [selectedKey],
        phase2aSelectedTestKeys: [selectedKey],
        phase2bSelectedCandidateFeatureKeys: [],
        phase3SelectedConsolidatedIds: ['tools::selected-case'],
        reportRebuildOnly: false,
      }
    }

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    expect(runPhase1Calls).toEqual([
      {
        parsedTestKeys: [
          'tests/tools/sample.test.ts::suite > first case',
          'tests/tools/sample.test.ts::suite > second case',
        ],
        selectedTestKeys: [selectedKey],
      },
    ])
    expect(runPhase2aCalls).toEqual([[selectedKey]])
    expect(runPhase2bCalls).toEqual([[]])
    expect(phase3Calls).toEqual([{ selectedConsolidatedIds: ['tools::selected-case'] }])
  })

  test('report-writer drift rebuilds markdown outputs without phase1 or phase2 model calls', async () => {
    await initializeGitRepo(root)

    const selectedKey = 'tests/tools/sample.test.ts::suite > first case'
    const previousManifest: IncrementalManifest = createIncrementalManifestFixture({
      lastStartCommit: 'previous-start',
      phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'reports-old' },
      tests: {
        [selectedKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > first case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: 'phase2-fp',
          extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: 'old-phase1',
          lastPhase2CompletedAt: 'old-phase2',
        }),
      },
    })
    const progress = createEmptyProgress(1)
    progress.phase1.extractedBehaviors[selectedKey] = createExtractedBehaviorFixture({
      testName: 'first case',
      fullPath: 'suite > first case',
      behavior: 'When the user triggers the first case, the stored behavior is reused.',
      context: 'Stored extracted context for the first case.',
      keywords: [],
    })
    progress.phase3.evaluations[selectedKey] = {
      testName: 'suite > first case',
      behavior: 'When the user triggers the first case, the stored behavior is reused.',
      userStory: 'As a user, I can rely on rebuilt report output.',
      maria: { discover: 4, use: 4, retain: 4, notes: 'Maria notes' },
      dani: { discover: 3, use: 3, retain: 3, notes: 'Dani notes' },
      viktor: { discover: 5, use: 5, retain: 5, notes: 'Viktor notes' },
      flaws: ['Stored flaw'],
      improvements: ['Stored improvement'],
    }

    loadManifestImpl = (): Promise<IncrementalManifest> => Promise.resolve(previousManifest)
    loadProgressImpl = (): Promise<Progress> => Promise.resolve(progress)
    selectIncrementalWorkImpl = (input: SelectIncrementalWorkInput): IncrementalSelection => {
      selectIncrementalWorkCalls = [...selectIncrementalWorkCalls, input]
      return {
        phase1SelectedTestKeys: [],
        phase2aSelectedTestKeys: [],
        phase2bSelectedCandidateFeatureKeys: [],
        phase3SelectedConsolidatedIds: [],
        reportRebuildOnly: true,
      }
    }

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    expect(runPhase1Calls).toHaveLength(0)
    expect(runPhase2aCalls).toHaveLength(0)
    expect(runPhase2bCalls).toHaveLength(0)

    const behaviorFileText = await Bun.file(
      path.join(reportsDir, 'behaviors', 'tools', 'sample.test.behaviors.md'),
    ).text()
    const storyFileText = await Bun.file(path.join(reportsDir, 'stories', 'tools.md')).text()
    const indexFileText = await Bun.file(path.join(reportsDir, 'stories', 'index.md')).text()

    expect(behaviorFileText).toContain('suite > first case')
    expect(storyFileText).toContain('As a user, I can rely on rebuilt report output.')
    expect(indexFileText).toContain('tools')
  })
})

describe('behavior-audit phase 1 incremental selection', () => {
  let root: string
  let reportsDir: string
  let manifestPath: string
  let progressPath: string

  beforeEach(async () => {
    root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    progressPath = path.join(reportsDir, 'progress.json')

    const testsDir = path.join(root, 'tests', 'tools')
    const srcDir = path.join(root, 'src', 'tools')
    mkdirSync(testsDir, { recursive: true })
    mkdirSync(srcDir, { recursive: true })
    writeWorkspaceFile(
      root,
      'tests/tools/sample.test.ts',
      [
        "describe('suite', () => {",
        "  test('selected case', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '',
        "  test('unselected case', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    writeWorkspaceFile(root, 'src/tools/sample.ts', 'export const sample = 1\n')

    mockReportsConfig(root, {
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
      PHASE2_TIMEOUT_MS: 600_000,
    })

    const realIncrementalModule = await loadIncrementalModule(`real=${crypto.randomUUID()}`)
    const realProgressModule = await loadProgressModule(`real=${crypto.randomUUID()}`)
    void mock.module('../../scripts/behavior-audit/incremental.js', () => ({ ...realIncrementalModule }))
    void mock.module('../../scripts/behavior-audit/progress.js', () => ({ ...realProgressModule }))
    void mock.module('../../scripts/behavior-audit/extract-agent.js', () => ({
      extractWithRetry: (): Promise<{
        readonly behavior: string
        readonly context: string
        readonly candidateKeywords: readonly string[]
      }> =>
        Promise.resolve({
          behavior: 'When the selected test runs, the bot returns the extracted behavior.',
          context: 'Calls the extractor and records the result for the selected test only.',
          candidateKeywords: ['test-extraction', 'behavior-verification'],
        }),
    }))
    void mock.module('../../scripts/behavior-audit/keyword-resolver-agent.js', () => ({
      resolveKeywordsWithRetry: (): Promise<{
        readonly keywords: readonly string[]
        readonly appendedEntries: readonly {
          readonly slug: string
          readonly description: string
          readonly createdAt: string
          readonly updatedAt: string
          readonly timesUsed: number
        }[]
      }> =>
        Promise.resolve({
          keywords: ['test-extraction', 'behavior-verification'],
          appendedEntries: [],
        }),
    }))
    void mock.module('../../scripts/behavior-audit/tools.js', () => ({
      makeAuditTools: (): Record<string, never> => ({}),
    }))
  })

  test('runPhase1 only processes selected test keys and writes manifest updates after successful extraction', async () => {
    const extract = await loadExtractModule(crypto.randomUUID())
    const testFilePath = 'tests/tools/sample.test.ts'
    const parsedFile = parseTestFile(testFilePath, await Bun.file(path.join(root, testFilePath)).text())
    const selectedKey = 'tests/tools/sample.test.ts::suite > selected case'
    const progress = createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [selectedKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > selected case',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'stale-phase1',
          phase2Fingerprint: 'stale-phase2',
          extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: null,
          lastPhase2CompletedAt: 'old-phase2',
        }),
      },
    }

    await extract.runPhase1({
      testFiles: [parsedFile],
      progress,
      selectedTestKeys: new Set([selectedKey]),
      manifest,
    })

    expect(Object.keys(progress.phase1.extractedBehaviors)).toEqual([selectedKey])
    expect(progress.phase1.completedTests[testFilePath]).toEqual({ [selectedKey]: 'done' })

    const savedManifest = await readSavedManifest(manifestPath)
    const savedEntry = getManifestEntry(savedManifest, selectedKey)
    expect(savedEntry.phase1Fingerprint).toBeTruthy()
    expect(savedEntry.phase2Fingerprint).toBeTruthy()
    expect(savedEntry.lastPhase2CompletedAt).toBeNull()
    expect(savedEntry.dependencyPaths).toEqual(['tests/tools/sample.test.ts', 'src/tools/sample.ts'])
    expect(savedEntry.domain).toBe('tools')
    expect(savedEntry.extractedBehaviorPath).toBe('reports/audit-behavior/behaviors/tools/sample.test.behaviors.md')
    expect(savedEntry.lastPhase1CompletedAt).toBeTruthy()
    expect(savedManifest.tests['tests/tools/sample.test.ts::suite > unselected case']).toBeUndefined()

    const behaviorFilePath = path.join(reportsDir, 'behaviors', 'tools', 'sample.test.behaviors.md')
    const behaviorFileText = await Bun.file(behaviorFilePath).text()
    expect(behaviorFileText).toContain('suite > selected case')
    expect(behaviorFileText).not.toContain('suite > unselected case')
  })
})

describe('behavior-audit phase 2a classify agent', () => {
  test('classifyBehaviorWithRetry does not sleep before the first resumed retry attempt', async () => {
    const events: string[] = []
    const originalSetTimeout = globalThis.setTimeout
    const mockSetTimeout = (
      handler: TimerHandler,
      _timeout: number | undefined,
      ...args: unknown[]
    ): ReturnType<typeof setTimeout> => {
      events.push('sleep')
      if (isCallableTimerHandler(handler)) {
        handler(...args)
      }
      return originalSetTimeout((): void => {}, 0)
    }

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PHASE2_TIMEOUT_MS: 300_000,
      MAX_RETRIES: 3,
      RETRY_BACKOFF_MS: [25, 50, 75] as const,
      MAX_STEPS: 20,
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): (() => string) => {
        return (): string => 'mock-model'
      },
    }))
    void mock.module('ai', () => ({
      generateText: (): Promise<{ readonly output: MockClassificationResult }> => {
        events.push('generate')
        return Promise.resolve({
          output: {
            visibility: 'user-facing',
            candidateFeatureKey: 'task-creation',
            candidateFeatureLabel: 'Task creation',
            supportingBehaviorRefs: [],
            relatedBehaviorHints: [],
            classificationNotes: 'Immediate resumed success.',
          },
        })
      },
      Output: {
        object: ({ schema }: { readonly schema: unknown }): { readonly schema: unknown } => ({ schema }),
      },
      stepCountIs: (value: number): number => value,
    }))

    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      writable: true,
      value: mockSetTimeout,
    })

    try {
      const classifyAgent = await loadClassifyAgentModule(crypto.randomUUID())
      const result = await classifyAgent.classifyBehaviorWithRetry('prompt', 1)

      expect(result === null ? null : result.candidateFeatureKey).toBe('task-creation')
      expect(events).toEqual(['generate'])
    } finally {
      Object.defineProperty(globalThis, 'setTimeout', {
        configurable: true,
        writable: true,
        value: originalSetTimeout,
      })
    }
  })
})

describe('behavior-audit interrupted-run baseline', () => {
  let root: string
  let reportsDir: string
  let manifestPath: string
  let progressPath: string
  let collectChangedFilesArgs: readonly (string | null)[]
  let selectionResults: readonly IncrementalSelection[]
  let runPhase1Calls: readonly {
    readonly parsedTestKeys: readonly string[]
    readonly selectedTestKeys: readonly string[]
  }[]
  let shouldInterruptPhase2: boolean

  beforeEach(async () => {
    root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    progressPath = path.join(reportsDir, 'progress.json')
    collectChangedFilesArgs = []
    selectionResults = []
    runPhase1Calls = []
    shouldInterruptPhase2 = true

    const testsDir = path.join(root, 'tests', 'tools')
    const srcDir = path.join(root, 'src', 'tools')
    mkdirSync(testsDir, { recursive: true })
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(
      path.join(testsDir, 'sample.test.ts'),
      ["describe('suite', () => {", "  test('case', () => {})", '})', ''].join('\n'),
    )
    writeFileSync(path.join(srcDir, 'sample.ts'), 'export const sample = 1\n')

    await initializeGitRepo(root)
    await commitAll(root, 'seed tracked behavior audit files')

    mockReportsConfig(root, {
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      PHASE2_TIMEOUT_MS: 600_000,
    })

    const realIncrementalModule = await loadIncrementalModule(`interrupted=${crypto.randomUUID()}`)
    const realProgressModule = await loadProgressModule(`interrupted=${crypto.randomUUID()}`)

    void mock.module('../../scripts/behavior-audit/incremental.js', () => ({
      ...realIncrementalModule,
      collectChangedFiles: (previousLastStartCommit: string | null): Promise<readonly string[]> => {
        collectChangedFilesArgs = [...collectChangedFilesArgs, previousLastStartCommit]
        return realIncrementalModule.collectChangedFiles(previousLastStartCommit)
      },
      selectIncrementalWork: (input: SelectIncrementalWorkInput): IncrementalSelection => {
        const selection = realIncrementalModule.selectIncrementalWork(input)
        selectionResults = [...selectionResults, selection]
        return selection
      },
    }))
    void mock.module('../../scripts/behavior-audit/progress.js', () => ({ ...realProgressModule }))
    void mock.module('../../scripts/behavior-audit/extract.js', () => ({
      runPhase1: async (input: {
        readonly testFiles: readonly ParsedTestFile[]
        readonly selectedTestKeys: ReadonlySet<string>
      }): Promise<void> => {
        runPhase1Calls = [
          ...runPhase1Calls,
          {
            parsedTestKeys: getParsedTestKeys(input.testFiles),
            selectedTestKeys: [...input.selectedTestKeys].toSorted(),
          },
        ]

        const selectedKey = [...input.selectedTestKeys].toSorted()[0]
        if (selectedKey === undefined) {
          return
        }

        const resolvedManifest = resolveNullableManifest(await realIncrementalModule.loadManifest())
        await realIncrementalModule.saveManifest({
          ...resolvedManifest,
          tests: {
            ...resolvedManifest.tests,
            [selectedKey]: {
              testFile: 'tests/tools/sample.test.ts',
              testName: 'suite > case',
              dependencyPaths: ['tests/tools/sample.test.ts', 'src/tools/sample.ts'],
              phase2aFingerprint: null,
              phase1Fingerprint: 'phase1-fingerprint',
              behaviorId: null,
              candidateFeatureKey: null,
              phase2Fingerprint: null,
              extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
              domain: 'tools',
              lastPhase1CompletedAt: '2026-04-17T12:00:00.000Z',
              lastPhase2aCompletedAt: null,
              lastPhase2CompletedAt: null,
            },
          },
        })
      },
    }))
    void mock.module('../../scripts/behavior-audit/classify.js', () => ({
      runPhase2a: (): Promise<ReadonlySet<string>> => Promise.resolve(new Set()),
    }))
    void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
      runPhase2b: (): Promise<
        IncrementalModuleShape['createEmptyConsolidatedManifest'] extends () => infer TResult ? TResult : never
      > => {
        if (shouldInterruptPhase2) {
          throw new Error('simulated interruption after run start')
        }
        return Promise.resolve(realIncrementalModule.createEmptyConsolidatedManifest())
      },
    }))
  })

  test('interrupted first run still seeds next incremental baseline from lastStartCommit', async () => {
    const initialHead = await runCommand(['git', 'rev-parse', 'HEAD'], root)
    const consoleErrorSpy = mock(() => {})
    const processExitSpy = mock((code: number | undefined) => {
      const exitCode = resolveExitCode(code)
      throw new Error(`process.exit:${exitCode}`)
    })

    const originalConsoleError = console.error
    console.error = consoleErrorSpy as typeof console.error
    process.exit = processExitSpy as typeof process.exit

    await expect(loadBehaviorAuditEntryPoint(crypto.randomUUID())).rejects.toThrow('process.exit:1')

    console.error = originalConsoleError
    process.exit = originalProcessExit

    const manifestAfterFirstRun = await readSavedManifest(manifestPath)
    expect(manifestAfterFirstRun.lastStartCommit).toBe(initialHead)

    writeFileSync(path.join(root, 'src', 'tools', 'sample.ts'), 'export const sample = 2\n')
    await commitAll(root, 'change mirrored source after interrupted run')
    shouldInterruptPhase2 = false

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    expect(collectChangedFilesArgs[1]).toBe(initialHead)
    expect(getArrayItem(selectionResults, 1).phase1SelectedTestKeys).toEqual([
      'tests/tools/sample.test.ts::suite > case',
    ])
    expect(getArrayItem(runPhase1Calls, 1).selectedTestKeys).toEqual(['tests/tools/sample.test.ts::suite > case'])
  })
})

test('runPhase1 does not persist a file as done when behavior-file write fails after manifest save', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const realProgressModule = await loadProgressModule(`phase1-write-fail-progress-${crypto.randomUUID()}`)
  const realIncrementalModule = await loadIncrementalModule(`phase1-write-fail-incremental-${crypto.randomUUID()}`)
  const realReportWriterModule = await loadReportWriterModule(`phase1-write-fail-report-writer-${crypto.randomUUID()}`)
  void mock.module('../../scripts/behavior-audit/progress.js', () => ({ ...realProgressModule }))
  void mock.module('../../scripts/behavior-audit/incremental.js', () => ({ ...realIncrementalModule }))

  void mock.module('../../scripts/behavior-audit/extract-agent.js', () => ({
    extractWithRetry: (): Promise<{
      readonly behavior: string
      readonly context: string
      readonly candidateKeywords: readonly string[]
    }> =>
      Promise.resolve({
        behavior: 'When a user targets a group, the bot routes the request correctly.',
        context: 'Routes through group context selection.',
        candidateKeywords: ['group-targeting'],
      }),
  }))

  void mock.module('../../scripts/behavior-audit/keyword-resolver-agent.js', () => ({
    resolveKeywordsWithRetry: (): Promise<{
      readonly keywords: readonly string[]
      readonly appendedEntries: readonly {
        readonly slug: string
        readonly description: string
        readonly createdAt: string
        readonly updatedAt: string
        readonly timesUsed: number
      }[]
    }> =>
      Promise.resolve({
        keywords: ['group-targeting'],
        appendedEntries: [
          {
            slug: 'group-targeting',
            description: 'Targeting work at a group context.',
            createdAt: '2026-04-20T12:00:00.000Z',
            updatedAt: '2026-04-20T12:00:00.000Z',
            timesUsed: 1,
          },
        ],
      }),
  }))

  void mock.module('../../scripts/behavior-audit/report-writer.js', () => {
    if (!isReportWriterModule(realReportWriterModule)) {
      throw new Error('Unexpected report writer module shape')
    }
    return {
      ...realReportWriterModule,
      writeBehaviorFile: (): Promise<void> => Promise.reject(new Error('disk full')),
    }
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const extract = await loadExtractModule(`phase1-write-fail-${crypto.randomUUID()}`)

  const progress = realProgressModule.createEmptyProgress(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)

  await expect(
    extract.runPhase1({
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest: realIncrementalModule.createEmptyManifest(),
    }),
  ).rejects.toThrow('disk full')

  expect(progress.phase1.completedFiles).toEqual([])
  expect(progress.phase1.status).not.toBe('done')
  expect(await Bun.file(progressPath).exists()).toBe(true)

  const persistedProgressText = await Bun.file(progressPath).text()
  const persistedProgress = JSON.parse(persistedProgressText) as unknown
  if (!isObject(persistedProgress) || !('phase1' in persistedProgress) || !isObject(persistedProgress['phase1'])) {
    throw new Error('Expected persisted progress shape')
  }
  const persistedPhase1 = persistedProgress['phase1']
  if (!('completedFiles' in persistedPhase1) || !Array.isArray(persistedPhase1['completedFiles'])) {
    throw new Error('Expected persisted phase1 completedFiles array')
  }
  if (!('completedTests' in persistedPhase1) || !isObject(persistedPhase1['completedTests'])) {
    throw new Error('Expected persisted phase1 completedTests record')
  }
  expect(persistedPhase1['completedFiles']).toEqual([])
  expect(persistedPhase1['completedTests']['tests/tools/sample.test.ts']).toBeUndefined()
})
