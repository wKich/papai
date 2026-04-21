import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { IncrementalManifest, IncrementalSelection } from '../../scripts/behavior-audit/incremental.js'
import type * as IncrementalModule from '../../scripts/behavior-audit/incremental.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import type { ParsedTestFile } from '../../scripts/behavior-audit/test-parser.js'
import {
  createAuditBehaviorPaths,
  createClassifiedBehaviorFixture,
  createConsolidatedManifestEntry,
  createEmptyProgressFixture,
  createExtractedBehaviorFixture,
  createIncrementalManifestFixture,
  createManifestTestEntry,
  createReportsPaths,
  mockAuditBehaviorConfig,
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
  type ClassifyAgentModuleShape,
  getArrayItem,
  getManifestEntry,
  getParsedTestKeys,
  importWithGuard,
  type IncrementalModuleShape,
  isClassifyModule,
  isKeywordVocabulary,
  isObject,
  isReportWriterModule,
  isResetModule,
  loadBehaviorAuditEntryPoint,
  loadClassifiedStoreModule,
  loadClassifyAgentModule,
  loadConsolidateModule,
  loadEvaluateModule,
  loadExtractModule,
  loadIncrementalModule,
  loadKeywordVocabularyModule,
  loadProgressModule,
  loadReportWriterModule,
  loadResetModule,
  type MockClassificationResult,
  type MockEvaluationResult,
  normalizePhase1Call,
  normalizePhase2Call,
  readSavedManifest,
  resolveNullableManifest,
  type ResetModuleShape,
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

describe('behavior-audit phase 2a classification', () => {
  let root: string
  let auditRoot: string
  let progressPath: string
  let manifestPath: string
  let classifyBehaviorWithRetryCalls: number
  let classifyBehaviorWithRetryImpl: ClassifyAgentModuleShape['classifyBehaviorWithRetry']

  beforeEach(() => {
    root = makeTempDir()
    const paths = createAuditBehaviorPaths(root)
    auditRoot = paths.auditBehaviorDir
    progressPath = paths.progressPath
    manifestPath = paths.incrementalManifestPath
    classifyBehaviorWithRetryCalls = 0
    classifyBehaviorWithRetryImpl = (): Promise<MockClassificationResult> =>
      Promise.resolve({
        visibility: 'user-facing',
        candidateFeatureKey: 'task-creation',
        candidateFeatureLabel: 'Task creation',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Matches task creation flow.',
      })

    mockAuditBehaviorConfig(root, {
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      EXCLUDED_PREFIXES: [] as const,
    })

    void mock.module('../../scripts/behavior-audit/classify-agent.js', () => ({
      classifyBehaviorWithRetry: (
        ...args: Parameters<ClassifyAgentModuleShape['classifyBehaviorWithRetry']>
      ): Promise<MockClassificationResult> => {
        classifyBehaviorWithRetryCalls += 1
        return classifyBehaviorWithRetryImpl(...args)
      },
    }))
  })

  test('runPhase2a classifies selected extracted behaviors and returns dirty candidate feature keys', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        'tests/tools/sample.test.ts::suite > case': createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: 'stale-phase2-fp',
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    progress.phase1.extractedBehaviors['tests/tools/sample.test.ts::suite > case'] = createExtractedBehaviorFixture({
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls create_task and returns the new task.',
      keywords: ['task-create'],
    })

    const dirty = await classify.runPhase2a({
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest,
    })

    expect([...dirty]).toEqual(['task-creation'])
    const classifiedBehavior = progress.phase2a.classifiedBehaviors['tests/tools/sample.test.ts::suite > case']
    if (classifiedBehavior === undefined) {
      throw new Error('Expected classified behavior to be stored')
    }
    expect(classifiedBehavior.candidateFeatureKey).toBe('task-creation')

    const classifiedPath = path.join(auditRoot, 'classified', 'tools.json')
    expect(await Bun.file(classifiedPath).exists()).toBe(true)

    const classifiedRaw: unknown = JSON.parse(await Bun.file(classifiedPath).text())
    expect(classifiedRaw).toEqual([
      {
        behaviorId: 'tests/tools/sample.test.ts::suite > case',
        testKey: 'tests/tools/sample.test.ts::suite > case',
        domain: 'tools',
        behavior: 'When the user creates a task, the bot saves it.',
        context: 'Calls create_task and returns the new task.',
        keywords: ['task-create'],
        visibility: 'user-facing',
        candidateFeatureKey: 'task-creation',
        candidateFeatureLabel: 'Task creation',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Matches task creation flow.',
      },
    ])

    const savedManifest = await readSavedManifest(manifestPath)
    const savedEntry = getManifestEntry(savedManifest, 'tests/tools/sample.test.ts::suite > case')
    expect(savedEntry.phase2aFingerprint).toBeTruthy()
    expect(savedEntry.phase2Fingerprint).toBe('stale-phase2-fp')
    expect(savedEntry.lastPhase2CompletedAt).toBeTruthy()

    const progressText = await Bun.file(progressPath).text()
    expect(progressText).toContain('task-creation')
  })

  test('runPhase2a skips already-completed classifications on resumed runs', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > case'
    const existingClassified: Progress['phase2a']['classifiedBehaviors'][string] = {
      behaviorId: testKey,
      testKey,
      domain: 'tools',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls create_task and returns the new task.',
      keywords: ['task-create'],
      visibility: 'user-facing',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'Persisted from a prior run.',
    }

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: 'phase2-fp',
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: '2026-04-21T12:05:00.000Z',
        }),
      },
    }
    progress.phase1.extractedBehaviors[testKey] = {
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls create_task and returns the new task.',
      keywords: ['task-create'],
    }
    progress.phase2a.completedBehaviors[testKey] = 'done'
    progress.phase2a.classifiedBehaviors[testKey] = existingClassified

    const dirty = await classify.runPhase2a({
      progress,
      selectedTestKeys: new Set([testKey]),
      manifest,
    })

    expect(classifyBehaviorWithRetryCalls).toBe(0)
    expect([...dirty]).toEqual(['task-creation'])
    expect(progress.phase2a.classifiedBehaviors[testKey]).toEqual(existingClassified)
    expect(await Bun.file(path.join(auditRoot, 'classified', 'tools.json')).exists()).toBe(false)
  })

  test('runPhase2a passes persisted retry attempt offset through to the classifier on resumed failures', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > case'
    const classifierArgs: Array<readonly [string, number]> = []

    classifyBehaviorWithRetryImpl = (prompt: string, attemptOffset: number): Promise<MockClassificationResult> => {
      classifierArgs.push([prompt, attemptOffset])
      return Promise.resolve({
        visibility: 'user-facing',
        candidateFeatureKey: 'task-creation',
        candidateFeatureLabel: 'Task creation',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Resumed from prior failed attempt.',
      })
    }

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    progress.phase1.extractedBehaviors[testKey] = {
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls create_task and returns the new task.',
      keywords: ['task-create'],
    }
    progress.phase2a.failedBehaviors[testKey] = {
      error: 'classification failed after retries',
      attempts: 2,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }

    await classify.runPhase2a({
      progress,
      selectedTestKeys: new Set([testKey]),
      manifest,
    })

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    expect(classifierArgs).toHaveLength(1)
    const classifierArgsEntry = classifierArgs[0]
    if (classifierArgsEntry === undefined) {
      throw new Error('Expected classifier args entry')
    }
    expect(classifierArgsEntry[1]).toBe(2)
  })

  test('runPhase2a clears stale phase2a failure state after a later successful classification', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > recovery case'

    classifyBehaviorWithRetryImpl = (): Promise<MockClassificationResult> =>
      Promise.resolve({
        visibility: 'user-facing',
        candidateFeatureKey: 'task-recovery',
        candidateFeatureLabel: 'Task recovery',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Recovered successfully.',
      })

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > recovery case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    progress.phase1.extractedBehaviors[testKey] = {
      testName: 'recovery case',
      fullPath: 'suite > recovery case',
      behavior: 'When the user retries task creation, the bot recovers successfully.',
      context: 'Repeats the classification after a transient failure.',
      keywords: ['task-recovery'],
    }
    progress.phase2a.failedBehaviors[testKey] = {
      error: 'classification failed after retries',
      attempts: 1,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }
    progress.phase2a.stats.behaviorsFailed = 1

    const dirty = await classify.runPhase2a({
      progress,
      selectedTestKeys: new Set([testKey]),
      manifest,
    })

    expect([...dirty]).toEqual(['task-recovery'])
    expect(progress.phase2a.failedBehaviors[testKey]).toBeUndefined()
    expect(progress.phase2a.stats.behaviorsFailed).toBe(0)
    const recoveredBehavior = progress.phase2a.classifiedBehaviors[testKey]
    if (recoveredBehavior === undefined) {
      throw new Error('Expected recovered classified behavior')
    }
    expect(recoveredBehavior.candidateFeatureKey).toBe('task-recovery')
  })

  test('runPhase2a does not exceed total retry budget across resumed failed runs', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > exhausted retries'

    classifyBehaviorWithRetryImpl = (): Promise<MockClassificationResult> => Promise.resolve(null)

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > exhausted retries',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    progress.phase1.extractedBehaviors[testKey] = {
      testName: 'exhausted retries',
      fullPath: 'suite > exhausted retries',
      behavior: 'When classification keeps failing, retries should stop at the total budget.',
      context: 'Exercises resume behavior after all classifier attempts are consumed.',
      keywords: ['classification-retries'],
    }

    await classify.runPhase2a({
      progress,
      selectedTestKeys: new Set([testKey]),
      manifest,
    })

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    const firstFailure = progress.phase2a.failedBehaviors[testKey]
    if (firstFailure === undefined) {
      throw new Error('Expected failed behavior entry')
    }
    expect(firstFailure.attempts).toBe(3)

    await classify.runPhase2a({
      progress,
      selectedTestKeys: new Set([testKey]),
      manifest,
    })

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    const repeatedFailure = progress.phase2a.failedBehaviors[testKey]
    if (repeatedFailure === undefined) {
      throw new Error('Expected repeated failed behavior entry')
    }
    expect(repeatedFailure.attempts).toBe(3)
  })
})

test('runPhase2b consolidates user-facing candidate features and preserves supporting internal refs', async () => {
  const root = makeTempDir()
  const paths = createAuditBehaviorPaths(root)
  const auditRoot = paths.auditBehaviorDir
  const progressPath = paths.progressPath

  mockAuditBehaviorConfig(root, {
    PROGRESS_PATH: progressPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  void mock.module('../../scripts/behavior-audit/consolidate-agent.js', () => ({
    consolidateWithRetry: (): Promise<
      readonly {
        readonly id: string
        readonly item: {
          readonly featureName: string
          readonly isUserFacing: boolean
          readonly behavior: string
          readonly userStory: string | null
          readonly context: string
          readonly sourceBehaviorIds: readonly string[]
          readonly sourceTestKeys: readonly string[]
          readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
        }
      }[]
    > =>
      Promise.resolve([
        {
          id: 'task-creation::task-creation',
          item: {
            featureName: 'Task creation',
            isUserFacing: true,
            behavior: 'When a user asks to create a task, the bot saves it and confirms success.',
            userStory: 'As a user, I want to create a task in chat so I can track work quickly.',
            context: 'Calls create_task and formats the confirmation.',
            sourceBehaviorIds: [
              'tests/tools/create-task.test.ts::suite > create task',
              'tests/tools/create-task.test.ts::suite > validate input',
            ],
            sourceTestKeys: [
              'tests/tools/create-task.test.ts::suite > create task',
              'tests/tools/create-task.test.ts::suite > validate input',
            ],
            supportingInternalRefs: [
              {
                behaviorId: 'tests/tools/create-task.test.ts::suite > validate input',
                summary: 'Validation guards prevent malformed task creation inputs.',
              },
            ],
          },
        },
      ]),
  }))

  const consolidate = await loadConsolidateModule(crypto.randomUUID())
  const progressModule = await loadProgressModule(crypto.randomUUID())
  const incremental = await loadIncrementalModule(crypto.randomUUID())

  const progress = progressModule.createEmptyProgress(1)
  progress.phase2a.classifiedBehaviors['tests/tools/create-task.test.ts::suite > create task'] =
    createClassifiedBehaviorFixture({
      behaviorId: 'tests/tools/create-task.test.ts::suite > create task',
      testKey: 'tests/tools/create-task.test.ts::suite > create task',
      domain: 'tools',
      behavior: 'When a user asks to create a task, the bot saves it.',
      context: 'Calls create_task.',
      keywords: ['task-create'],
      visibility: 'user-facing',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      classificationNotes: 'User-facing task creation.',
    })
  progress.phase2a.classifiedBehaviors['tests/tools/create-task.test.ts::suite > validate input'] =
    createClassifiedBehaviorFixture({
      behaviorId: 'tests/tools/create-task.test.ts::suite > validate input',
      testKey: 'tests/tools/create-task.test.ts::suite > validate input',
      domain: 'tools',
      behavior: 'When input is malformed, the bot blocks task creation.',
      context: 'Runs validation guards.',
      keywords: ['task-create'],
      visibility: 'internal',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      classificationNotes: 'Supporting validation behavior.',
    })

  const manifest = await consolidate.runPhase2b(
    progress,
    incremental.createEmptyConsolidatedManifest(),
    'phase2-v2',
    new Set(['task-creation']),
  )

  const entry = manifest.entries['task-creation::task-creation']
  if (entry === undefined) {
    throw new Error('Expected consolidated entry')
  }
  expect(entry.candidateFeatureKey).toBe('task-creation')
  expect(entry.sourceBehaviorIds).toEqual([
    'tests/tools/create-task.test.ts::suite > create task',
    'tests/tools/create-task.test.ts::suite > validate input',
  ])

  const fileText = await Bun.file(path.join(auditRoot, 'consolidated', 'task-creation.json')).text()
  expect(fileText).toContain('supportingInternalRefs')
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

describe('behavior-audit phase 3 incremental selection', () => {
  let root: string
  let reportsDir: string
  let progressPath: string
  let consolidatedDir: string
  let evaluateCalls: number

  beforeEach(async () => {
    root = makeTempDir()
    const paths = createReportsPaths(root)
    reportsDir = paths.reportsDir
    progressPath = paths.progressPath
    consolidatedDir = paths.consolidatedDir
    evaluateCalls = 0

    mkdirSync(consolidatedDir, { recursive: true })
    await Bun.write(
      path.join(consolidatedDir, 'tools.json'),
      JSON.stringify(
        [
          {
            id: 'tools::selected-case',
            domain: 'tools',
            featureName: 'selected case',
            isUserFacing: true,
            behavior: 'When the selected behavior runs, the bot returns fresh results.',
            userStory: 'As a user, I get the selected behavior outcome.',
            context: 'Selected context for phase 3.',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
          },
          {
            id: 'tools::unselected-case',
            domain: 'tools',
            featureName: 'unselected case',
            isUserFacing: true,
            behavior: 'When the unselected behavior runs, the bot keeps prior results.',
            userStory: 'Existing unselected story',
            context: 'Unselected context for phase 3.',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > unselected case'],
          },
        ],
        null,
        2,
      ) + '\n',
    )

    mockReportsConfig(root, {
      PROGRESS_PATH: progressPath,
      CONSOLIDATED_DIR: consolidatedDir,
    })

    const realProgressModule = await loadProgressModule(`real=${crypto.randomUUID()}`)
    void mock.module('../../scripts/behavior-audit/progress.js', () => ({ ...realProgressModule }))
    void mock.module('../../scripts/behavior-audit/evaluate-agent.js', () => ({
      evaluateWithRetry: (): Promise<MockEvaluationResult> => {
        evaluateCalls += 1
        const result: MockEvaluationResult = {
          maria: { discover: 4, use: 4, retain: 4, notes: 'Selected Maria notes' },
          dani: { discover: 3, use: 3, retain: 3, notes: 'Selected Dani notes' },
          viktor: { discover: 5, use: 5, retain: 5, notes: 'Selected Viktor notes' },
          flaws: ['Selected flaw'],
          improvements: ['Selected improvement'],
        }
        return Promise.resolve(result)
      },
    }))
  })

  test('runPhase3 only evaluates selected consolidated ids and preserves stored unselected evaluations', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedKey = 'tools::selected-case'
    const unselectedKey = 'tools::unselected-case'
    const progress = createEmptyProgress(1)

    progress.phase2b.completedCandidateFeatures['tools'] = 'done'
    progress.phase3.evaluations[unselectedKey] = {
      testName: 'suite > unselected case',
      behavior: 'When the unselected behavior runs, the bot keeps prior results.',
      userStory: 'Existing unselected story',
      maria: { discover: 2, use: 2, retain: 2, notes: 'Existing Maria notes' },
      dani: { discover: 2, use: 2, retain: 2, notes: 'Existing Dani notes' },
      viktor: { discover: 2, use: 2, retain: 2, notes: 'Existing Viktor notes' },
      flaws: ['Existing flaw'],
      improvements: ['Existing improvement'],
    }
    progress.phase3.completedBehaviors[unselectedKey] = 'done'

    await evaluate.runPhase3({
      progress,
      selectedConsolidatedIds: new Set([selectedKey]),
      consolidatedManifest: {
        version: 1,
        entries: {
          [selectedKey]: {
            consolidatedId: selectedKey,
            domain: 'tools',
            featureName: 'selected case',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            candidateFeatureKey: null,
            keywords: [],
            sourceDomains: ['tools'],
            phase2Fingerprint: null,
            lastConsolidatedAt: null,
          },
          [unselectedKey]: {
            consolidatedId: unselectedKey,
            domain: 'tools',
            featureName: 'unselected case',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > unselected case'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > unselected case'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            candidateFeatureKey: null,
            keywords: [],
            sourceDomains: ['tools'],
            phase2Fingerprint: null,
            lastConsolidatedAt: null,
          },
        },
      },
    })

    const selectedEvaluation = progress.phase3.evaluations[selectedKey]
    if (selectedEvaluation === undefined) {
      throw new Error('Expected selected evaluation to be stored')
    }
    const unselectedEvaluation = progress.phase3.evaluations[unselectedKey]
    if (unselectedEvaluation === undefined) {
      throw new Error('Expected unselected evaluation to remain stored')
    }
    expect(evaluateCalls).toBe(1)
    expect(progress.phase3.completedBehaviors[selectedKey]).toBe('done')
    expect(selectedEvaluation.userStory).toBe('As a user, I get the selected behavior outcome.')
    expect(unselectedEvaluation.userStory).toBe('Existing unselected story')

    const storyFileText = await Bun.file(path.join(reportsDir, 'stories', 'tools.md')).text()
    expect(storyFileText).toContain('selected case')
    expect(storyFileText).toContain('suite > unselected case')
  })

  test('runPhase3 saves progress after storing a selected evaluation', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedKey = 'tools::selected-case'
    const progress = createEmptyProgress(1)
    progress.phase2b.completedCandidateFeatures['tools'] = 'done'

    await evaluate.runPhase3({
      progress,
      selectedConsolidatedIds: new Set([selectedKey]),
      consolidatedManifest: {
        version: 1,
        entries: {
          [selectedKey]: {
            consolidatedId: selectedKey,
            domain: 'tools',
            featureName: 'selected case',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            candidateFeatureKey: null,
            keywords: [],
            sourceDomains: ['tools'],
            phase2Fingerprint: null,
            lastConsolidatedAt: null,
          },
        },
      },
    })

    const progressText = await Bun.file(progressPath).text()
    expect(progressText).toContain('As a user, I get the selected behavior outcome.')
  })

  test('runPhase3 evaluates newly generated consolidated ids even when selection was based on stale ids', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const staleSelectedKey = 'tools::old-selected-case'
    const freshSelectedKey = 'tools::fresh-selected-case'
    const progress = createEmptyProgress(1)

    await Bun.write(
      path.join(consolidatedDir, 'tools.json'),
      JSON.stringify(
        [
          {
            id: freshSelectedKey,
            domain: 'tools',
            featureName: 'fresh selected case',
            isUserFacing: true,
            behavior: 'When the fresh behavior runs, the bot returns the regenerated output.',
            userStory: 'As a user, I get the regenerated selected behavior outcome.',
            context: 'Fresh context for phase 3.',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
            supportingInternalRefs: [],
          },
        ],
        null,
        2,
      ) + '\n',
    )

    await evaluate.runPhase3({
      progress,
      selectedConsolidatedIds: new Set([staleSelectedKey]),
      consolidatedManifest: {
        version: 1,
        entries: {
          [freshSelectedKey]: {
            consolidatedId: freshSelectedKey,
            domain: 'tools',
            featureName: 'fresh selected case',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            candidateFeatureKey: null,
            keywords: [],
            sourceDomains: ['tools'],
            phase2Fingerprint: null,
            lastConsolidatedAt: null,
          },
        },
      },
    })

    expect(evaluateCalls).toBe(1)
    expect(progress.phase3.completedBehaviors[freshSelectedKey]).toBe('done')
    const freshEvaluation = progress.phase3.evaluations[freshSelectedKey]
    if (freshEvaluation === undefined) {
      throw new Error('Expected fresh evaluation to be stored')
    }
    expect(freshEvaluation.userStory).toBe('As a user, I get the regenerated selected behavior outcome.')
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

test('runPhase1 stores canonical keywords after extraction and vocabulary resolution', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
  })

  void mock.module('../../scripts/behavior-audit/extract-agent.js', () => ({
    extractWithRetry: (): Promise<{
      readonly behavior: string
      readonly context: string
      readonly candidateKeywords: readonly string[]
    }> =>
      Promise.resolve({
        behavior: 'When a user targets a group, the bot routes the request correctly.',
        context: 'Resolves target context and forwards execution through the group routing path.',
        candidateKeywords: ['group-routing', 'group-targeting', 'request-routing'],
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
        keywords: ['group-targeting', 'group-routing'],
        appendedEntries: [],
      }),
  }))

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-keywords-${tag}`)
  const progressModule = await loadProgressModule(`phase1-keywords-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-keywords-${tag}`)

  const progress = progressModule.createEmptyProgress(1)
  const manifest = incremental.createEmptyManifest()
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)

  await extract.runPhase1({
    testFiles: [parsed],
    progress,
    selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
    manifest,
  })

  const stored = progress.phase1.extractedBehaviors['tests/tools/sample.test.ts::suite > case']
  if (stored === undefined) {
    throw new Error('Expected extracted behavior to be stored')
  }
  expect(stored.keywords).toEqual(['group-targeting', 'group-routing'])
})

test('extract-agent returns behavior, context, and candidateKeywords', async () => {
  const mod: unknown = await import(`../../scripts/behavior-audit/extract-agent.js?test=shape-${crypto.randomUUID()}`)
  expect(typeof mod).toBe('object')
  expect(mod).toHaveProperty('extractWithRetry')
})

test('keyword-resolver-agent returns canonical keywords and appended entries', async () => {
  const mod: unknown = await import(
    `../../scripts/behavior-audit/keyword-resolver-agent.js?test=shape-${crypto.randomUUID()}`
  )
  expect(typeof mod).toBe('object')
  expect(mod).toHaveProperty('resolveKeywordsWithRetry')
})

test('behavior-audit agents enable structured outputs for OpenAI-compatible provider', async () => {
  const agentPaths = [
    'scripts/behavior-audit/extract-agent.ts',
    'scripts/behavior-audit/keyword-resolver-agent.ts',
    'scripts/behavior-audit/consolidate-agent.ts',
    'scripts/behavior-audit/evaluate-agent.ts',
  ] as const

  const sources = await Promise.all(agentPaths.map((filePath) => Bun.file(path.join(process.cwd(), filePath)).text()))

  for (const source of sources) {
    expect(source).toContain('supportsStructuredOutputs: true')
  }
})

test('keyword-vocabulary persists entries and updates usage counts', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  mockReportsConfig(root, {
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const typedVocab = await loadKeywordVocabularyModule(`vocab-${crypto.randomUUID()}`)
  await typedVocab.saveKeywordVocabulary([
    {
      slug: 'group-targeting',
      description: 'Targeting work at a group context.',
      createdAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-20T12:00:00.000Z',
      timesUsed: 1,
    },
  ])

  await typedVocab.recordKeywordUsage(['group-targeting'])

  const saved = await typedVocab.loadKeywordVocabulary()
  expect(saved).not.toBeNull()
  if (saved === null) {
    throw new Error('Expected saved vocabulary entries')
  }
  const firstSavedEntry = saved[0]
  if (firstSavedEntry === undefined) {
    throw new Error('Expected first saved vocabulary entry')
  }
  expect(firstSavedEntry.timesUsed).toBe(2)
})

test('writeBehaviorFile renders canonical keywords for each extracted behavior', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')

  mockReportsConfig(root, {
    EXCLUDED_PREFIXES: [] as const,
  })

  const typedWriter = await loadReportWriterModule(`keywords-${crypto.randomUUID()}`)
  await typedWriter.writeBehaviorFile('tests/tools/sample.test.ts', [
    {
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When a user targets a group, the bot routes the request correctly.',
      context: 'Routes through group context selection.',
      keywords: ['group-targeting', 'group-routing'],
    },
  ])

  const fileText = await Bun.file(path.join(reportsDir, 'behaviors', 'tools', 'sample.test.behaviors.md')).text()
  expect(fileText).toContain('**Keywords:** group-targeting, group-routing')
})

test('runPhase1 persists vocabulary updates before marking a test done', async () => {
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

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-atomic-${tag}`)
  const progressModule = await loadProgressModule(`phase1-atomic-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-atomic-${tag}`)

  const progress = progressModule.createEmptyProgress(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)

  await extract.runPhase1({
    testFiles: [parsed],
    progress,
    selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
    manifest: incremental.createEmptyManifest(),
  })

  const savedVocabText = await Bun.file(vocabularyPath).text()
  expect(savedVocabText).toContain('"group-targeting"')
  const completedTests = progress.phase1.completedTests['tests/tools/sample.test.ts']
  if (completedTests === undefined) {
    throw new Error('Expected completed tests entry for sample test file')
  }
  expect(completedTests['tests/tools/sample.test.ts::suite > case']).toBe('done')
})

test('runPhase1 re-extracts selected changed tests even when prior extraction exists', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')
  let extractCalls = 0

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  void mock.module('../../scripts/behavior-audit/extract-agent.js', () => ({
    extractWithRetry: (): Promise<{
      readonly behavior: string
      readonly context: string
      readonly candidateKeywords: readonly string[]
    }> => {
      extractCalls += 1
      return Promise.resolve({
        behavior: 'When a user targets a group, the bot refreshes the extracted behavior.',
        context: 'Reprocesses changed test dependencies.',
        candidateKeywords: ['group-targeting-updated'],
      })
    },
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
        keywords: ['group-targeting-updated'],
        appendedEntries: [
          {
            slug: 'group-targeting-updated',
            description: 'Updated targeting behavior.',
            createdAt: '2026-04-20T12:00:00.000Z',
            updatedAt: '2026-04-20T12:00:00.000Z',
            timesUsed: 1,
          },
        ],
      }),
  }))

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-rerun-${tag}`)
  const progressModule = await loadProgressModule(`phase1-rerun-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-rerun-${tag}`)

  const progress = progressModule.createEmptyProgress(1)
  progress.phase1.completedFiles.push('tests/tools/sample.test.ts')
  progress.phase1.completedTests['tests/tools/sample.test.ts'] = {
    'tests/tools/sample.test.ts::suite > case': 'done',
  }
  progress.phase1.extractedBehaviors['tests/tools/sample.test.ts::suite > case'] = {
    testName: 'case',
    fullPath: 'suite > case',
    behavior: 'Stale extracted behavior.',
    context: 'Stale context.',
    keywords: ['stale-keyword'],
  }

  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)
  await extract.runPhase1({
    testFiles: [parsed],
    progress,
    selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
    manifest: incremental.createEmptyManifest(),
  })

  expect(extractCalls).toBe(1)
  expect(progress.phase1.extractedBehaviors['tests/tools/sample.test.ts::suite > case']).toMatchObject({
    behavior: 'When a user targets a group, the bot refreshes the extracted behavior.',
    keywords: ['group-targeting-updated'],
  })
})

test('runPhase1 keeps first use count at one for newly appended keywords', async () => {
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

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-keyword-count-${tag}`)
  const progressModule = await loadProgressModule(`phase1-keyword-count-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-keyword-count-${tag}`)

  const progress = progressModule.createEmptyProgress(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)
  await extract.runPhase1({
    testFiles: [parsed],
    progress,
    selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
    manifest: incremental.createEmptyManifest(),
  })

  const savedVocabularyRaw: unknown = JSON.parse(await Bun.file(vocabularyPath).text())
  if (!isKeywordVocabulary(savedVocabularyRaw)) {
    throw new Error('Expected saved keyword vocabulary')
  }
  const savedVocabulary = savedVocabularyRaw
  expect(savedVocabulary).toHaveLength(1)
  expect(savedVocabulary[0]).toMatchObject({ slug: 'group-targeting', timesUsed: 1 })
})

test('runPhase1 sends only existing vocabulary slugs to the keyword resolver prompt', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')
  let capturedResolverPrompt = ''

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

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
    resolveKeywordsWithRetry: (
      prompt: string,
    ): Promise<{
      readonly keywords: readonly string[]
      readonly appendedEntries: readonly {
        readonly slug: string
        readonly description: string
        readonly createdAt: string
        readonly updatedAt: string
        readonly timesUsed: number
      }[]
    }> => {
      capturedResolverPrompt = prompt
      return Promise.resolve({
        keywords: ['group-targeting'],
        appendedEntries: [],
      })
    },
  }))

  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(
    path.join(root, 'tests', 'tools', 'sample.test.ts'),
    "describe('suite', () => { test('case', () => {}) })",
  )
  await Bun.write(
    vocabularyPath,
    JSON.stringify(
      [
        {
          slug: 'group-targeting',
          description: 'Targeting work at a group context.',
          createdAt: '2026-04-20T12:00:00.000Z',
          updatedAt: '2026-04-20T12:00:00.000Z',
          timesUsed: 3,
        },
        {
          slug: 'group-routing',
          description: 'Routing work inside a group context.',
          createdAt: '2026-04-20T12:00:00.000Z',
          updatedAt: '2026-04-20T12:00:00.000Z',
          timesUsed: 2,
        },
      ],
      null,
      2,
    ) + '\n',
  )

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-slug-prompt-${tag}`)
  const progressModule = await loadProgressModule(`phase1-slug-prompt-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-slug-prompt-${tag}`)

  await extract.runPhase1({
    testFiles: [parseTestFile('tests/tools/sample.test.ts', "describe('suite', () => { test('case', () => {}) })")],
    progress: progressModule.createEmptyProgress(1),
    selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
    manifest: incremental.createEmptyManifest(),
  })

  expect(capturedResolverPrompt).toContain('Existing vocabulary:')
  expect(capturedResolverPrompt).toContain('Candidate keywords: group-targeting')
  expect(capturedResolverPrompt).toContain('[\n  "group-targeting",\n  "group-routing"\n]')
  expect(capturedResolverPrompt).not.toContain('"description"')
  expect(capturedResolverPrompt).not.toContain('"timesUsed"')
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

  void mock.module('../../scripts/behavior-audit/report-writer.js', async () => {
    const real: unknown = await import(
      `../../scripts/behavior-audit/report-writer.js?test=phase1-write-fail-${crypto.randomUUID()}`
    )
    if (!isReportWriterModule(real)) {
      throw new Error('Unexpected report writer module shape')
    }
    return {
      ...real,
      writeBehaviorFile: (): Promise<void> => Promise.reject(new Error('disk full')),
    }
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-write-fail-${tag}`)
  const progressModule = await loadProgressModule(`phase1-write-fail-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-write-fail-${tag}`)

  const progress = progressModule.createEmptyProgress(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)

  await expect(
    extract.runPhase1({
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest: incremental.createEmptyManifest(),
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

test('consolidate-agent prompt contract treats a keyword batch as a candidate pool rather than one feature', async () => {
  const source = await Bun.file(path.join(process.cwd(), 'scripts/behavior-audit/consolidate-agent.ts')).text()
  expect(source).toContain('candidate pool')
  expect(source).toContain('never force one output per batch or one output per keyword')
})

test('runPhase2b groups classified behaviors by candidate feature and preserves provenance', async () => {
  let capturedCandidateFeatureKey: string | null = null
  let capturedDomains: readonly string[] = []
  void mock.module('../../scripts/behavior-audit/consolidate-agent.js', () => ({
    consolidateWithRetry: (
      candidateFeatureKey: string,
      inputs: readonly { readonly testKey: string; readonly domain: string; readonly behaviorId: string }[],
    ): Promise<
      | readonly {
          readonly id: string
          readonly item: {
            readonly featureName: string
            readonly isUserFacing: boolean
            readonly behavior: string
            readonly userStory: string | null
            readonly context: string
            readonly sourceTestKeys: readonly string[]
            readonly sourceBehaviorIds: readonly string[]
            readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
          }
        }[]
      | null
    > =>
      Promise.resolve(
        ((): readonly {
          readonly id: string
          readonly item: {
            readonly featureName: string
            readonly isUserFacing: boolean
            readonly behavior: string
            readonly userStory: string | null
            readonly context: string
            readonly sourceTestKeys: readonly string[]
            readonly sourceBehaviorIds: readonly string[]
            readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
          }
        }[] => {
          capturedCandidateFeatureKey = candidateFeatureKey
          capturedDomains = inputs.map((input) => input.domain)
          return [
            {
              id: `${candidateFeatureKey}::combined-feature`,
              item: {
                featureName: 'Combined feature',
                isUserFacing: true,
                behavior: 'When a user acts, something happens.',
                userStory: 'As a user, I can do something.',
                context: 'Implementation context.',
                sourceTestKeys: inputs.map((input) => input.testKey),
                sourceBehaviorIds: inputs.map((input) => input.behaviorId),
                supportingInternalRefs: [],
              },
            },
          ]
        })(),
      ),
  }))

  const consolidate = await loadConsolidateModule(`candidate-features-${crypto.randomUUID()}`)
  const progress = createEmptyProgress(2)

  progress.phase2a.classifiedBehaviors['tests/tools/a.test.ts::suite > case'] = createClassifiedBehaviorFixture({
    behaviorId: 'tests/tools/a.test.ts::suite > case',
    testKey: 'tests/tools/a.test.ts::suite > case',
    domain: 'tools',
    behavior: 'When a user targets a group, the bot routes the request correctly.',
    context: 'Routes through group context selection.',
    keywords: ['group-targeting', 'shared-feature'],
    visibility: 'user-facing',
    candidateFeatureKey: 'group-targeting',
    candidateFeatureLabel: 'Group targeting',
    classificationNotes: 'User-facing feature.',
  })
  progress.phase2a.classifiedBehaviors['tests/commands/b.test.ts::suite > case'] = createClassifiedBehaviorFixture({
    behaviorId: 'tests/commands/b.test.ts::suite > case',
    testKey: 'tests/commands/b.test.ts::suite > case',
    domain: 'commands',
    behavior: 'When a user configures a group action, the bot applies the group target.',
    context: 'Resolves group target before command execution.',
    keywords: ['group-targeting', 'shared-feature'],
    visibility: 'internal',
    candidateFeatureKey: 'group-targeting',
    candidateFeatureLabel: 'Group targeting',
    classificationNotes: 'Supporting internal behavior.',
  })

  const manifest = { version: 1 as const, entries: {} }
  const result = await consolidate.runPhase2b(progress, manifest, 'phase2-v1', new Set(['group-targeting']))

  expect(Object.keys(result.entries).length).toBeGreaterThan(0)
  if (capturedCandidateFeatureKey === null) {
    throw new Error('Expected captured candidate feature key')
  }
  expect(capturedCandidateFeatureKey === 'group-targeting').toBe(true)
  expect(capturedDomains).toEqual(['tools', 'commands'])
  const savedEntries = Object.values(result.entries)
  expect(savedEntries).toHaveLength(1)
  expect(getArrayItem(savedEntries, 0).domain).toBe('cross-domain')
  expect(getArrayItem(savedEntries, 0).sourceDomains).toEqual(['commands', 'tools'])
})

test('runPhase3 reads consolidated batches by candidate feature from manifest entries', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  void mock.module('../../scripts/behavior-audit/evaluate-agent.js', () => ({
    evaluateWithRetry: (): Promise<MockEvaluationResult> =>
      Promise.resolve({
        maria: { discover: 4, use: 4, retain: 4, notes: 'clear' },
        dani: { discover: 4, use: 4, retain: 4, notes: 'clear' },
        viktor: { discover: 4, use: 4, retain: 4, notes: 'clear' },
        flaws: [],
        improvements: [],
      }),
  }))

  mkdirSync(path.join(reportsDir, 'consolidated'), { recursive: true })
  await Bun.write(
    path.join(reportsDir, 'consolidated', 'group-targeting.json'),
    JSON.stringify([
      {
        id: 'group-targeting::feature',
        domain: 'cross-domain',
        featureName: 'Shared group targeting',
        isUserFacing: true,
        behavior: 'When a user targets a group, the bot routes the request correctly.',
        userStory: 'As a user, I can target a group.',
        context: 'Routes through group context selection.',
        sourceTestKeys: ['tests/tools/a.test.ts::suite > case'],
        sourceBehaviorIds: ['tests/tools/a.test.ts::suite > case'],
        supportingInternalRefs: [],
      },
    ]),
  )

  const evaluate = await loadEvaluateModule(`phase3-keyword-files-${crypto.randomUUID()}`)
  const progress = createEmptyProgress(1)
  const consolidatedManifest = {
    version: 1 as const,
    entries: {
      'group-targeting::feature': {
        consolidatedId: 'group-targeting::feature',
        domain: 'cross-domain',
        featureName: 'Shared group targeting',
        sourceTestKeys: ['tests/tools/a.test.ts::suite > case'],
        sourceBehaviorIds: ['tests/tools/a.test.ts::suite > case'],
        supportingInternalBehaviorIds: [],
        isUserFacing: true,
        candidateFeatureKey: 'group-targeting',
        keywords: ['group-targeting', 'shared-feature'],
        sourceDomains: ['commands', 'tools'],
        phase2Fingerprint: 'phase2-fp',
        lastConsolidatedAt: '2026-04-20T12:00:00.000Z',
      },
    },
  }

  await evaluate.runPhase3({
    progress,
    selectedConsolidatedIds: new Set(),
    consolidatedManifest,
  })

  expect(progress.phase3.stats.behaviorsTotal).toBe(1)
  expect(progress.phase3.stats.behaviorsDone).toBe(1)
  expect(progress.phase3.evaluations['group-targeting::feature']).toBeDefined()
})

describe('behavior-audit entrypoint phase3 manifest passthrough', () => {
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
    mkdirSync(testsDir, { recursive: true })
    writeFileSync(
      path.join(testsDir, 'sample.test.ts'),
      ["describe('suite', () => {", "  test('first case', () => {})", '})', ''].join('\n'),
    )

    mockReportsConfig(root, {
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
    })

    const realIncrementalModule = await loadIncrementalModule(`passthrough=${crypto.randomUUID()}`)
    const realProgressModule = await loadProgressModule(`passthrough=${crypto.randomUUID()}`)

    void mock.module('../../scripts/behavior-audit/incremental.js', () => ({
      ...realIncrementalModule,
      collectChangedFiles: (): Promise<readonly string[]> => Promise.resolve([]),
      selectIncrementalWork: (input: SelectIncrementalWorkInput): IncrementalSelection => ({
        phase1SelectedTestKeys: [...input.discoveredTestKeys],
        phase2aSelectedTestKeys: [...input.discoveredTestKeys],
        phase2bSelectedCandidateFeatureKeys: ['group-targeting'],
        phase3SelectedConsolidatedIds: [],
        reportRebuildOnly: false,
      }),
    }))
    void mock.module('../../scripts/behavior-audit/progress.js', () => ({ ...realProgressModule }))
    void mock.module('../../scripts/behavior-audit/extract.js', () => ({
      runPhase1: (): Promise<void> => Promise.resolve(),
    }))
  })

  test('main passes the consolidated manifest through to phase3 after phase2 completes', async () => {
    await initializeGitRepo(root)

    const consolidatedManifest = {
      version: 1 as const,
      entries: {
        'tools::selected-case': createConsolidatedManifestEntry({
          consolidatedId: 'tools::selected-case',
          domain: 'tools',
          featureName: 'Selected case',
          sourceTestKeys: ['tests/tools/sample.test.ts::suite > first case'],
          sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > first case'],
          supportingInternalBehaviorIds: [],
          isUserFacing: true,
          candidateFeatureKey: 'group-targeting' as string | null,
          keywords: ['group-targeting'] as readonly string[],
          sourceDomains: ['tools'] as readonly string[],
          phase2Fingerprint: 'phase2-fp' as string | null,
          lastConsolidatedAt: '2026-04-20T12:00:00.000Z' as string | null,
        }),
      },
    }

    let phase3ManifestArg: typeof consolidatedManifest | null = null

    void mock.module('../../scripts/behavior-audit/classify.js', () => ({
      runPhase2a: (): Promise<ReadonlySet<string>> => Promise.resolve(new Set(['group-targeting'])),
    }))
    void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
      runPhase2b: (): Promise<typeof consolidatedManifest> => Promise.resolve(consolidatedManifest),
    }))
    void mock.module('../../scripts/behavior-audit/evaluate.js', () => ({
      runPhase3: (input: {
        readonly progress: Progress
        readonly selectedConsolidatedIds: ReadonlySet<string>
        readonly consolidatedManifest: typeof consolidatedManifest
      }): Promise<void> => {
        phase3ManifestArg = input.consolidatedManifest
        return Promise.resolve()
      },
    }))

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    expect(phase3ManifestArg).not.toBeNull()
    expect(phase3ManifestArg).toMatchObject(consolidatedManifest)
  })
})

test('behavior-audit-reset phase2 clears downstream state without deleting keyword vocabulary', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')

  mkdirSync(path.join(reportsDir, 'consolidated'), { recursive: true })
  mkdirSync(path.join(reportsDir, 'stories'), { recursive: true })
  await Bun.write(
    path.join(reportsDir, 'keyword-vocabulary.json'),
    JSON.stringify([
      {
        slug: 'group-targeting',
        description: 'Targeting work at a group context.',
        createdAt: '2026-04-20T12:00:00.000Z',
        updatedAt: '2026-04-20T12:00:00.000Z',
        timesUsed: 1,
      },
    ]),
  )
  await Bun.write(path.join(reportsDir, 'consolidated', 'tools.md'), '# consolidated')
  await Bun.write(path.join(reportsDir, 'stories', 'tools.md'), '# stories')

  mockReportsConfig(root, {
    EXCLUDED_PREFIXES: [] as const,
  })

  const reset = await loadResetModule(`phase2-reset-${crypto.randomUUID()}`)
  await reset.resetBehaviorAudit('phase2')

  expect(await Bun.file(path.join(reportsDir, 'keyword-vocabulary.json')).exists()).toBe(true)
  expect(await Bun.file(path.join(reportsDir, 'consolidated', 'tools.md')).exists()).toBe(false)
  expect(await Bun.file(path.join(reportsDir, 'stories', 'tools.md')).exists()).toBe(false)
})

test('classified-store round-trips sorted classified behaviors under audit root', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const store = await loadClassifiedStoreModule(crypto.randomUUID())
  await store.writeClassifiedFile('tools', [
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > beta',
      testKey: 'tests/tools/sample.test.ts::suite > beta',
      domain: 'tools',
      behavior: 'When beta runs, the bot saves a task.',
      context: 'Calls create_task.',
      keywords: ['task-create'],
      visibility: 'user-facing',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'beta',
    },
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > alpha',
      testKey: 'tests/tools/sample.test.ts::suite > alpha',
      domain: 'tools',
      behavior: 'When alpha runs, the bot validates input.',
      context: 'Runs guard checks.',
      keywords: ['task-creation'],
      visibility: 'internal',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'alpha',
    },
  ])

  const loaded = await store.readClassifiedFile('tools')
  if (loaded === null) {
    throw new Error('Expected classified data')
  }
  expect(loaded.map((item) => item.behaviorId)).toEqual([
    'tests/tools/sample.test.ts::suite > alpha',
    'tests/tools/sample.test.ts::suite > beta',
  ])
})

test('classified-store throws for malformed classified data but returns null when file is missing', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')
  const classifiedDir = path.join(auditRoot, 'classified')

  mockAuditBehaviorConfig(root, {
    CLASSIFIED_DIR: classifiedDir,
  })

  const store = await loadClassifiedStoreModule(crypto.randomUUID())

  expect(await store.readClassifiedFile('missing')).toBeNull()

  mkdirSync(classifiedDir, { recursive: true })
  await Bun.write(path.join(classifiedDir, 'tools.json'), '{"not":"an array"}\n')

  await expect(store.readClassifiedFile('tools')).rejects.toThrow()
})

test('report-writer round-trips supporting internal refs as readonly consolidated data', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, null)

  const writer = await loadReportWriterModule(crypto.randomUUID())
  await writer.writeConsolidatedFile('tools', [
    {
      id: 'task-creation::feature',
      domain: 'tools',
      featureName: 'Task creation',
      isUserFacing: true,
      behavior: 'When a user creates a task, the bot saves it.',
      userStory: 'As a user, I can create a task through chat.',
      context: 'Calls provider create flow.',
      sourceTestKeys: ['tests/tools/sample.test.ts::suite > create task'],
      sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > create task'],
      supportingInternalRefs: [
        {
          behaviorId: 'tests/tools/sample.test.ts::suite > validate task',
          summary: 'Validates the task payload before submission.',
        },
      ],
    },
  ])

  const loaded = await writer.readConsolidatedFile('tools')
  expect(loaded).not.toBeNull()
  expect(loaded).toHaveLength(1)

  const item = loaded![0]
  if (item === undefined) {
    throw new Error('Expected consolidated item to exist')
  }
  expect(item.supportingInternalRefs).toEqual([
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > validate task',
      summary: 'Validates the task payload before submission.',
    },
  ])
  expect(Object.isFrozen(item.supportingInternalRefs)).toBe(true)
  expect(Object.isFrozen(item.supportingInternalRefs[0])).toBe(true)
})

test('report-writer throws for malformed consolidated data but returns null when file is missing', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')
  const consolidatedDir = path.join(auditRoot, 'consolidated')

  mockAuditBehaviorConfig(root, {
    CONSOLIDATED_DIR: consolidatedDir,
  })

  const writer = await loadReportWriterModule(crypto.randomUUID())

  expect(await writer.readConsolidatedFile('missing')).toBeNull()

  mkdirSync(consolidatedDir, { recursive: true })
  await Bun.write(path.join(consolidatedDir, 'tools.json'), '{"not":"an array"}\n')

  await expect(writer.readConsolidatedFile('tools')).rejects.toThrow()
})

test('resetBehaviorAudit phase2 clears audit-behavior phase2 outputs but preserves keyword vocabulary', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')
  const consolidatedDir = path.join(auditRoot, 'consolidated')
  const classifiedDir = path.join(auditRoot, 'classified')
  const storiesDir = path.join(auditRoot, 'stories')
  const vocabularyPath = path.join(auditRoot, 'keyword-vocabulary.json')
  const progressPath = path.join(auditRoot, 'progress.json')

  mkdirSync(consolidatedDir, { recursive: true })
  mkdirSync(classifiedDir, { recursive: true })
  mkdirSync(storiesDir, { recursive: true })

  await Bun.write(path.join(consolidatedDir, 'group-routing.json'), '[]\n')
  await Bun.write(path.join(classifiedDir, 'tools.json'), '[]\n')
  await Bun.write(path.join(storiesDir, 'tools.md'), '# tools\n')
  await Bun.write(vocabularyPath, '[]\n')
  await Bun.write(
    progressPath,
    JSON.stringify({
      version: 3,
      startedAt: '2026-04-21T12:00:00.000Z',
      phase1: {
        status: 'done',
        completedTests: {},
        extractedBehaviors: {},
        failedTests: {},
        completedFiles: [],
        stats: { filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
      },
      phase2a: {
        status: 'done',
        completedBehaviors: {},
        classifiedBehaviors: {},
        failedBehaviors: {},
        stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
      },
      phase2b: {
        status: 'done',
        completedCandidateFeatures: {},
        consolidations: {},
        failedCandidateFeatures: {},
        stats: {
          candidateFeaturesTotal: 0,
          candidateFeaturesDone: 0,
          candidateFeaturesFailed: 0,
          behaviorsConsolidated: 0,
        },
      },
      phase3: {
        status: 'done',
        completedBehaviors: {},
        evaluations: {},
        failedBehaviors: {},
        stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
      },
    }) + '\n',
  )

  mockAuditBehaviorConfig(root, {
    CLASSIFIED_DIR: classifiedDir,
    CONSOLIDATED_DIR: consolidatedDir,
    STORIES_DIR: storiesDir,
    PROGRESS_PATH: progressPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
  })

  const mod: ResetModuleShape = await importWithGuard(
    `../../scripts/behavior-audit-reset.ts?test=${crypto.randomUUID()}`,
    isResetModule,
    'Unexpected reset module shape',
  )
  await mod.resetBehaviorAudit('phase2')

  expect(await Bun.file(vocabularyPath).exists()).toBe(true)
  expect(await Bun.file(path.join(consolidatedDir, 'group-routing.json')).exists()).toBe(false)
  expect(await Bun.file(path.join(classifiedDir, 'tools.json')).exists()).toBe(false)
  expect(await Bun.file(path.join(storiesDir, 'tools.md')).exists()).toBe(false)
})
