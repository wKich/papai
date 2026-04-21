import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type * as ResetModule from '../../scripts/behavior-audit-reset.js'
import type * as ConsolidateModule from '../../scripts/behavior-audit/consolidate.js'
import type * as ClassifiedStoreModule from '../../scripts/behavior-audit/classified-store.js'
import type * as EvaluateModule from '../../scripts/behavior-audit/evaluate.js'
import type * as ExtractModule from '../../scripts/behavior-audit/extract.js'
import type { IncrementalManifest, IncrementalSelection } from '../../scripts/behavior-audit/incremental.js'
import type * as IncrementalModule from '../../scripts/behavior-audit/incremental.js'
import type * as KeywordVocabularyModule from '../../scripts/behavior-audit/keyword-vocabulary.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import type * as ProgressModule from '../../scripts/behavior-audit/progress.js'
import type * as ReportWriterModule from '../../scripts/behavior-audit/report-writer.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import type { ParsedTestFile } from '../../scripts/behavior-audit/test-parser.js'

const tempDirs: string[] = []
const originalProcessExit = process.exit.bind(process)
const originalOpenAiApiKey = process.env['OPENAI_API_KEY']

type IncrementalModuleShape = typeof IncrementalModule
type ProgressModuleShape = typeof ProgressModule
type ExtractModuleShape = typeof ExtractModule
type EvaluateModuleShape = typeof EvaluateModule
type ConsolidateModuleShape = typeof ConsolidateModule
type ClassifiedStoreModuleShape = typeof ClassifiedStoreModule
type KeywordVocabularyModuleShape = typeof KeywordVocabularyModule
type ReportWriterModuleShape = typeof ReportWriterModule
type ResetModuleShape = typeof ResetModule
type SelectIncrementalWorkInput = Parameters<IncrementalModuleShape['selectIncrementalWork']>[0]
type CaptureRunStartResult = ReturnType<IncrementalModuleShape['captureRunStart']>
type ManifestTestEntry = IncrementalManifest['tests'][string]
type MockEvaluationResult = Awaited<
  ReturnType<(typeof import('../../scripts/behavior-audit/evaluate-agent.js'))['evaluateWithRetry']>
>

function hasFunctionProperty(value: Record<string, unknown>, key: string): boolean {
  return key in value && typeof value[key] === 'function'
}

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'behavior-audit-integration-'))
  tempDirs.push(dir)
  return dir
}

async function runCommand(command: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const errorMessage = stderr.trim()
    throw new Error(errorMessage.length > 0 ? errorMessage : `Command failed: ${command.join(' ')}`)
  }
  return stdout.trim()
}

async function initializeGitRepo(root: string): Promise<void> {
  await runCommand(['git', 'init', '-q'], root)
  await runCommand(
    [
      'git',
      '-c',
      'user.name=Test User',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'init',
      '-q',
    ],
    root,
  )
}

async function commitAll(root: string, message: string): Promise<void> {
  await runCommand(['git', 'add', '.'], root)
  await runCommand(
    [
      'git',
      '-c',
      'user.name=Test User',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      message,
      '-q',
    ],
    root,
  )
}

function createEmptyProgress(filesTotal: number): Progress {
  return {
    version: 2,
    startedAt: '2026-04-17T12:00:00.000Z',
    phase1: {
      status: 'not-started',
      completedTests: {},
      extractedBehaviors: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
    phase2: {
      status: 'not-started',
      completedBatches: {},
      consolidations: {},
      failedBatches: {},
      stats: { batchesTotal: 0, batchesDone: 0, batchesFailed: 0, behaviorsConsolidated: 0 },
    },
    phase3: {
      status: 'not-started',
      completedBehaviors: {},
      evaluations: {},
      failedBehaviors: {},
      stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
    },
  }
}

function createEmptyManifest(): IncrementalManifest {
  return {
    version: 1,
    lastStartCommit: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    phaseVersions: { phase1: '', phase2: '', reports: '' },
    tests: {},
  }
}

function getParsedTestKeys(testFiles: readonly ParsedTestFile[]): readonly string[] {
  return testFiles
    .flatMap((testFile) => testFile.tests.map((testCase) => `${testFile.filePath}::${testCase.fullPath}`))
    .toSorted()
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringOrNull(value: unknown): value is string | null {
  if (typeof value === 'string') {
    return true
  }
  return value === null
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
}

function isKeywordVocabularyEntry(value: unknown): value is {
  readonly slug: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly timesUsed: number
} {
  return (
    isObject(value) &&
    'slug' in value &&
    typeof value['slug'] === 'string' &&
    'description' in value &&
    typeof value['description'] === 'string' &&
    'createdAt' in value &&
    typeof value['createdAt'] === 'string' &&
    'updatedAt' in value &&
    typeof value['updatedAt'] === 'string' &&
    'timesUsed' in value &&
    typeof value['timesUsed'] === 'number'
  )
}

function isKeywordVocabulary(value: unknown): value is readonly {
  readonly slug: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly timesUsed: number
}[] {
  return Array.isArray(value) && value.every((entry) => isKeywordVocabularyEntry(entry))
}

function isManifestTestEntry(value: unknown): value is ManifestTestEntry {
  return (
    isObject(value) &&
    'testFile' in value &&
    typeof value['testFile'] === 'string' &&
    'testName' in value &&
    typeof value['testName'] === 'string' &&
    'dependencyPaths' in value &&
    isStringArray(value['dependencyPaths']) &&
    'phase1Fingerprint' in value &&
    isStringOrNull(value['phase1Fingerprint']) &&
    'phase2Fingerprint' in value &&
    isStringOrNull(value['phase2Fingerprint']) &&
    'extractedBehaviorPath' in value &&
    isStringOrNull(value['extractedBehaviorPath']) &&
    'domain' in value &&
    typeof value['domain'] === 'string' &&
    'lastPhase1CompletedAt' in value &&
    isStringOrNull(value['lastPhase1CompletedAt']) &&
    'lastPhase2CompletedAt' in value &&
    isStringOrNull(value['lastPhase2CompletedAt'])
  )
}

function isIncrementalManifest(value: unknown): value is IncrementalManifest {
  if (!isObject(value)) {
    return false
  }
  if (!('version' in value) || value['version'] !== 1) {
    return false
  }
  if (!('lastStartCommit' in value) || !isStringOrNull(value['lastStartCommit'])) {
    return false
  }
  if (!('lastStartedAt' in value) || !isStringOrNull(value['lastStartedAt'])) {
    return false
  }
  if (!('lastCompletedAt' in value) || !isStringOrNull(value['lastCompletedAt'])) {
    return false
  }
  if (!('phaseVersions' in value) || !isObject(value['phaseVersions'])) {
    return false
  }
  const phaseVersions = value['phaseVersions']
  if (
    !('phase1' in phaseVersions) ||
    typeof phaseVersions['phase1'] !== 'string' ||
    !('phase2' in phaseVersions) ||
    typeof phaseVersions['phase2'] !== 'string' ||
    !('reports' in phaseVersions) ||
    typeof phaseVersions['reports'] !== 'string'
  ) {
    return false
  }
  if (!('tests' in value) || !isObject(value['tests'])) {
    return false
  }
  return Object.values(value['tests']).every((entry) => isManifestTestEntry(entry))
}

function isIncrementalModule(value: unknown): value is IncrementalModuleShape {
  return (
    isObject(value) &&
    hasFunctionProperty(value, 'createEmptyManifest') &&
    hasFunctionProperty(value, 'captureRunStart') &&
    hasFunctionProperty(value, 'loadManifest') &&
    hasFunctionProperty(value, 'saveManifest') &&
    hasFunctionProperty(value, 'collectChangedFiles') &&
    hasFunctionProperty(value, 'selectIncrementalWork')
  )
}

function isProgressModule(value: unknown): value is ProgressModuleShape {
  return (
    isObject(value) &&
    hasFunctionProperty(value, 'loadProgress') &&
    hasFunctionProperty(value, 'createEmptyProgress') &&
    hasFunctionProperty(value, 'saveProgress')
  )
}

function isExtractModule(value: unknown): value is ExtractModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'runPhase1')
}

function isEvaluateModule(value: unknown): value is EvaluateModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'runPhase3')
}

async function importWithGuard<T>(
  specifier: string,
  guard: (value: unknown) => value is T,
  errorMessage: string,
): Promise<T> {
  const mod: unknown = await import(specifier)
  if (!guard(mod)) {
    throw new Error(errorMessage)
  }
  return mod
}

function getArrayItem<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) {
    throw new Error(`Expected array item at index ${index}`)
  }
  return value
}

function getManifestEntry(manifest: IncrementalManifest, key: string): ManifestTestEntry {
  const entry = manifest.tests[key]
  if (entry === undefined) {
    throw new Error(`Expected manifest entry for ${key}`)
  }
  return entry
}

async function readSavedManifest(filePath: string): Promise<IncrementalManifest> {
  const raw: unknown = JSON.parse(await Bun.file(filePath).text())
  if (!isIncrementalManifest(raw)) {
    throw new Error('Unexpected manifest shape')
  }
  return raw
}

function resolveNullableManifest(manifest: IncrementalManifest | null): IncrementalManifest {
  if (manifest === null) {
    return createEmptyManifest()
  }
  return manifest
}

function resolveExitCode(code: number | undefined): number {
  if (code === undefined) {
    return 0
  }
  return code
}

function isParsedTestFile(value: unknown): value is ParsedTestFile {
  return (
    isObject(value) &&
    'filePath' in value &&
    'tests' in value &&
    typeof value['filePath'] === 'string' &&
    Array.isArray(value['tests'])
  )
}

function isPhase1Input(value: unknown): value is {
  readonly testFiles: readonly ParsedTestFile[]
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
} {
  return (
    isObject(value) &&
    'testFiles' in value &&
    Array.isArray(value['testFiles']) &&
    value['testFiles'].every((item) => isParsedTestFile(item)) &&
    'selectedTestKeys' in value &&
    value['selectedTestKeys'] instanceof Set &&
    'progress' in value
  )
}

function isPhase2Input(value: unknown): value is {
  readonly progress: Progress
  readonly selectedConsolidatedIds: ReadonlySet<string>
} {
  return (
    isObject(value) &&
    'selectedConsolidatedIds' in value &&
    value['selectedConsolidatedIds'] instanceof Set &&
    'progress' in value
  )
}

function normalizePhase1Call(args: readonly unknown[]): {
  readonly parsedTestKeys: readonly string[]
  readonly selectedTestKeys: readonly string[]
} {
  const firstArg = args[0]
  if (isPhase1Input(firstArg)) {
    return {
      parsedTestKeys: getParsedTestKeys(firstArg.testFiles),
      selectedTestKeys: [...firstArg.selectedTestKeys].toSorted(),
    }
  }

  if (Array.isArray(firstArg) && firstArg.every((item) => isParsedTestFile(item))) {
    return {
      parsedTestKeys: getParsedTestKeys(firstArg),
      selectedTestKeys: [],
    }
  }

  return { parsedTestKeys: [], selectedTestKeys: [] }
}

function normalizePhase2Call(args: readonly unknown[]): { readonly selectedConsolidatedIds: readonly string[] } {
  const firstArg = args[0]
  if (isPhase2Input(firstArg)) {
    return { selectedConsolidatedIds: [...firstArg.selectedConsolidatedIds].toSorted() }
  }
  return { selectedConsolidatedIds: [] }
}

async function loadBehaviorAuditEntryPoint(tag: string): Promise<void> {
  await import(`../../scripts/behavior-audit.ts?test=${tag}`)
}

function loadIncrementalModule(tag: string): Promise<IncrementalModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/incremental.js?test=${tag}`,
    isIncrementalModule,
    'Unexpected incremental module shape',
  )
}

function loadProgressModule(tag: string): Promise<ProgressModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/progress.js?test=${tag}`,
    isProgressModule,
    'Unexpected progress module shape',
  )
}

function loadExtractModule(tag: string): Promise<ExtractModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/extract.js?test=${tag}`,
    isExtractModule,
    'Unexpected extract module shape',
  )
}

function loadEvaluateModule(tag: string): Promise<EvaluateModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/evaluate.js?test=${tag}`,
    isEvaluateModule,
    'Unexpected evaluate module shape',
  )
}

function isConsolidateModule(value: unknown): value is ConsolidateModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'runPhase2')
}

function isClassifiedStoreModule(value: unknown): value is ClassifiedStoreModuleShape {
  return (
    isObject(value) &&
    hasFunctionProperty(value, 'writeClassifiedFile') &&
    hasFunctionProperty(value, 'readClassifiedFile')
  )
}

function isKeywordVocabularyModule(value: unknown): value is KeywordVocabularyModuleShape {
  return (
    isObject(value) &&
    hasFunctionProperty(value, 'loadKeywordVocabulary') &&
    hasFunctionProperty(value, 'saveKeywordVocabulary') &&
    hasFunctionProperty(value, 'recordKeywordUsage')
  )
}

function isReportWriterModule(value: unknown): value is ReportWriterModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'writeBehaviorFile')
}

function isResetModule(value: unknown): value is ResetModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'resetBehaviorAudit')
}

function loadConsolidateModule(tag: string): Promise<ConsolidateModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/consolidate.js?test=${tag}`,
    isConsolidateModule,
    'Unexpected consolidate module shape',
  )
}

function loadClassifiedStoreModule(tag: string): Promise<ClassifiedStoreModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/classified-store.js?test=${tag}`,
    isClassifiedStoreModule,
    'Unexpected classified-store module shape',
  )
}

function loadKeywordVocabularyModule(tag: string): Promise<KeywordVocabularyModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/keyword-vocabulary.js?test=${tag}`,
    isKeywordVocabularyModule,
    'Unexpected keyword vocabulary module shape',
  )
}

function loadReportWriterModule(tag: string): Promise<ReportWriterModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/report-writer.js?test=${tag}`,
    isReportWriterModule,
    'Unexpected report writer module shape',
  )
}

function loadResetModule(tag: string): Promise<ResetModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit-reset.js?test=${tag}`,
    isResetModule,
    'Unexpected reset module shape',
  )
}

beforeEach(() => {
  process.env['OPENAI_API_KEY'] = originalOpenAiApiKey ?? 'test-openai-api-key'
})

afterEach(() => {
  if (originalOpenAiApiKey === undefined) {
    delete process.env['OPENAI_API_KEY']
  } else {
    process.env['OPENAI_API_KEY'] = originalOpenAiApiKey
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
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
  let runPhase2Calls: readonly { readonly selectedConsolidatedIds: readonly string[] }[]

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
        phase2SelectedTestKeys: [...input.discoveredTestKeys].toSorted(),
        phase3SelectedConsolidatedIds: [],
        reportRebuildOnly: false,
      }
    }
    loadProgressImpl = (): Promise<Progress | null> => Promise.resolve(null)
    createEmptyProgressCalls = []
    runPhase1Calls = []
    runPhase2Calls = []

    const testsDir = path.join(root, 'tests', 'tools')
    mkdirSync(testsDir, { recursive: true })
    writeFileSync(
      path.join(testsDir, 'sample.test.ts'),
      ["describe('suite', () => {", "  test('first case', () => {})", "  test('second case', () => {})", '})', ''].join(
        '\n',
      ),
    )

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
      CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
      STORIES_DIR: path.join(reportsDir, 'stories'),
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      CONSOLIDATED_MANIFEST_PATH: consolidatedManifestPath,
      KEYWORD_VOCABULARY_PATH: path.join(reportsDir, 'keyword-vocabulary.json'),
      PHASE1_TIMEOUT_MS: 1_200_000,
      PHASE2_TIMEOUT_MS: 300_000,
      PHASE3_TIMEOUT_MS: 600_000,
      MAX_RETRIES: 3,
      RETRY_BACKOFF_MS: [100_000, 300_000, 900_000] as const,
      MAX_STEPS: 20,
      EXCLUDED_PREFIXES: [
        'tests/e2e/',
        'tests/client/',
        'tests/helpers/',
        'tests/scripts/',
        'tests/review-loop/',
        'tests/types/',
      ] as const,
    }))
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
        runPhase2Calls = [...runPhase2Calls, normalizePhase2Call(args)]
        return Promise.resolve()
      },
    }))
    void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
      runPhase2: (): Promise<IncrementalModule.ConsolidatedManifest> => Promise.resolve({ version: 1, entries: {} }),
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
    expect(runPhase2Calls).toEqual([{ selectedConsolidatedIds: [] }])
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
    expect(runPhase2Calls).toHaveLength(0)
  })

  test('main passes incremental selection through to both phases', async () => {
    await initializeGitRepo(root)

    const previousManifest = {
      ...createEmptyManifest(),
      lastStartCommit: 'previous-start',
      phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      tests: {
        'tests/tools/sample.test.ts::suite > first case': {
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > first case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'fp1',
          phase2Fingerprint: 'fp2',
          extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: 'x',
          lastPhase2CompletedAt: 'y',
        },
      },
    }
    const selectedKeys = ['tests/tools/sample.test.ts::suite > first case']
    loadManifestImpl = (): Promise<IncrementalManifest> => Promise.resolve(previousManifest)
    collectChangedFilesImpl = (): Promise<readonly string[]> => Promise.resolve(['tests/tools/sample.test.ts'])
    selectIncrementalWorkImpl = (input: SelectIncrementalWorkInput): IncrementalSelection => {
      selectIncrementalWorkCalls = [...selectIncrementalWorkCalls, input]
      return {
        phase1SelectedTestKeys: selectedKeys,
        phase2SelectedTestKeys: selectedKeys,
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
    expect(runPhase2Calls).toEqual([{ selectedConsolidatedIds: ['tools::selected-case'] }])
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
        phase2: {
          ...createEmptyProgress(1).phase2,
          status: 'done',
          completedBatches: { 'group-targeting': 'done' },
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
        phase2SelectedTestKeys: [selectedKey],
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
    expect(runPhase2Calls).toEqual([{ selectedConsolidatedIds: ['tools::selected-case'] }])
  })

  test('report-writer drift rebuilds markdown outputs without phase1 or phase2 model calls', async () => {
    await initializeGitRepo(root)

    const selectedKey = 'tests/tools/sample.test.ts::suite > first case'
    const previousManifest: IncrementalManifest = {
      ...createEmptyManifest(),
      lastStartCommit: 'previous-start',
      phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'reports-old' },
      tests: {
        [selectedKey]: {
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > first case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: 'phase2-fp',
          extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: 'old-phase1',
          lastPhase2CompletedAt: 'old-phase2',
        },
      },
    }
    const progress = createEmptyProgress(1)
    progress.phase1.extractedBehaviors[selectedKey] = {
      testName: 'first case',
      fullPath: 'suite > first case',
      behavior: 'When the user triggers the first case, the stored behavior is reused.',
      context: 'Stored extracted context for the first case.',
      keywords: [],
    }
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
        phase2SelectedTestKeys: [],
        phase3SelectedConsolidatedIds: [],
        reportRebuildOnly: true,
      }
    }

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    expect(runPhase1Calls).toHaveLength(0)
    expect(runPhase2Calls).toHaveLength(0)

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
    writeFileSync(
      path.join(testsDir, 'sample.test.ts'),
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
    writeFileSync(path.join(srcDir, 'sample.ts'), 'export const sample = 1\n')

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
      STORIES_DIR: path.join(reportsDir, 'stories'),
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
      KEYWORD_VOCABULARY_PATH: path.join(reportsDir, 'keyword-vocabulary.json'),
      PHASE1_TIMEOUT_MS: 1_200_000,
      PHASE2_TIMEOUT_MS: 600_000,
      MAX_RETRIES: 3,
      RETRY_BACKOFF_MS: [0, 0, 0] as const,
      MAX_STEPS: 20,
      EXCLUDED_PREFIXES: [
        'tests/e2e/',
        'tests/client/',
        'tests/helpers/',
        'tests/scripts/',
        'tests/review-loop/',
        'tests/types/',
      ] as const,
    }))

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
        [selectedKey]: {
          testFile: testFilePath,
          testName: 'suite > selected case',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'stale-phase1',
          phase2Fingerprint: 'stale-phase2',
          extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: null,
          lastPhase2CompletedAt: 'old-phase2',
        },
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
    expect(savedEntry.extractedBehaviorPath).toBe('reports/behaviors/tools/sample.test.behaviors.md')
    expect(savedEntry.lastPhase1CompletedAt).toBeTruthy()
    expect(savedManifest.tests['tests/tools/sample.test.ts::suite > unselected case']).toBeUndefined()

    const behaviorFilePath = path.join(reportsDir, 'behaviors', 'tools', 'sample.test.behaviors.md')
    const behaviorFileText = await Bun.file(behaviorFilePath).text()
    expect(behaviorFileText).toContain('suite > selected case')
    expect(behaviorFileText).not.toContain('suite > unselected case')
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
    reportsDir = path.join(root, 'reports')
    progressPath = path.join(reportsDir, 'progress.json')
    consolidatedDir = path.join(reportsDir, 'consolidated')
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

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
      CONSOLIDATED_DIR: consolidatedDir,
      STORIES_DIR: path.join(reportsDir, 'stories'),
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: path.join(reportsDir, 'incremental-manifest.json'),
      CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
      PHASE1_TIMEOUT_MS: 1_200_000,
      PHASE2_TIMEOUT_MS: 300_000,
      PHASE3_TIMEOUT_MS: 600_000,
      MAX_RETRIES: 3,
      RETRY_BACKOFF_MS: [0, 0, 0] as const,
      MAX_STEPS: 20,
      EXCLUDED_PREFIXES: [
        'tests/e2e/',
        'tests/client/',
        'tests/helpers/',
        'tests/scripts/',
        'tests/review-loop/',
        'tests/types/',
      ] as const,
    }))

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

    progress.phase2.completedBatches['tools'] = 'done'
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
            isUserFacing: true,
            primaryKeyword: null,
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
            isUserFacing: true,
            primaryKeyword: null,
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
    progress.phase2.completedBatches['tools'] = 'done'

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
            isUserFacing: true,
            primaryKeyword: null,
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
            isUserFacing: true,
            primaryKeyword: 'group-targeting',
            keywords: ['group-targeting'],
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

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
      STORIES_DIR: path.join(reportsDir, 'stories'),
      CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
      CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
      KEYWORD_VOCABULARY_PATH: path.join(reportsDir, 'keyword-vocabulary.json'),
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      PHASE1_TIMEOUT_MS: 1_200_000,
      PHASE2_TIMEOUT_MS: 600_000,
      PHASE3_TIMEOUT_MS: 600_000,
      MAX_RETRIES: 3,
      RETRY_BACKOFF_MS: [0, 0, 0] as const,
      MAX_STEPS: 20,
      EXCLUDED_PREFIXES: [
        'tests/e2e/',
        'tests/client/',
        'tests/helpers/',
        'tests/scripts/',
        'tests/review-loop/',
        'tests/types/',
      ] as const,
    }))

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
              phase1Fingerprint: 'phase1-fingerprint',
              phase2Fingerprint: null,
              extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
              domain: 'tools',
              lastPhase1CompletedAt: '2026-04-17T12:00:00.000Z',
              lastPhase2CompletedAt: null,
            },
          },
        })
      },
    }))
    void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
      runPhase2: (): Promise<
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

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [
      'tests/e2e/',
      'tests/client/',
      'tests/helpers/',
      'tests/scripts/',
      'tests/review-loop/',
      'tests/types/',
    ] as const,
  }))

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

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: path.join(reportsDir, 'progress.json'),
    INCREMENTAL_MANIFEST_PATH: path.join(reportsDir, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

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

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: path.join(reportsDir, 'progress.json'),
    INCREMENTAL_MANIFEST_PATH: path.join(reportsDir, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: path.join(reportsDir, 'keyword-vocabulary.json'),
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

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

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

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

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

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

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

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

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

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

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

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

test('runPhase2 groups cross-domain behaviors by primary keyword and preserves provenance', async () => {
  let capturedPrimaryKeyword: string | null = null
  let capturedDomains: readonly string[] = []
  void mock.module('../../scripts/behavior-audit/consolidate-agent.js', () => ({
    consolidateWithRetry: (
      primaryKeyword: string,
      inputs: readonly { readonly testKey: string; readonly domain: string }[],
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
          }
        }[] => {
          capturedPrimaryKeyword = primaryKeyword
          capturedDomains = inputs.map((input) => input.domain)
          return [
            {
              id: `${primaryKeyword}::combined-feature`,
              item: {
                featureName: 'Combined feature',
                isUserFacing: true,
                behavior: 'When a user acts, something happens.',
                userStory: 'As a user, I can do something.',
                context: 'Implementation context.',
                sourceTestKeys: inputs.map((input) => input.testKey),
              },
            },
          ]
        })(),
      ),
  }))

  const consolidate = await loadConsolidateModule(`keyword-batches-${crypto.randomUUID()}`)
  const progress = createEmptyProgress(2)

  progress.phase1.extractedBehaviors['tests/tools/a.test.ts::suite > case'] = {
    testName: 'case',
    fullPath: 'suite > case',
    behavior: 'When a user targets a group, the bot routes the request correctly.',
    context: 'Routes through group context selection.',
    keywords: ['group-targeting', 'shared-feature'],
  }
  progress.phase1.extractedBehaviors['tests/commands/b.test.ts::suite > case'] = {
    testName: 'case',
    fullPath: 'suite > case',
    behavior: 'When a user configures a group action, the bot applies the group target.',
    context: 'Resolves group target before command execution.',
    keywords: ['group-targeting', 'shared-feature'],
  }

  const manifest = { version: 1 as const, entries: {} }
  const result = await consolidate.runPhase2(progress, manifest, 'phase2-v1', new Set())

  expect(Object.keys(result.entries).length).toBeGreaterThan(0)
  if (capturedPrimaryKeyword === null) {
    throw new Error('Expected captured primary keyword')
  }
  const capturedPrimaryKeywordValue: string = capturedPrimaryKeyword
  expect(capturedPrimaryKeywordValue).toBe('group-targeting')
  expect(capturedDomains).toEqual(['tools', 'commands'])
  const savedEntries = Object.values(result.entries)
  expect(savedEntries).toHaveLength(1)
  expect(getArrayItem(savedEntries, 0).domain).toBe('cross-domain')
  expect(getArrayItem(savedEntries, 0).sourceDomains).toEqual(['commands', 'tools'])
})

test('runPhase2 accepts omitted selectedTestKeys for backward compatibility', async () => {
  void mock.module('../../scripts/behavior-audit/consolidate-agent.js', () => ({
    consolidateWithRetry: (
      primaryKeyword: string,
      inputs: readonly { readonly testKey: string }[],
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
          }
        }[]
      | null
    > =>
      Promise.resolve([
        {
          id: `${primaryKeyword}::feature`,
          item: {
            featureName: 'Feature',
            isUserFacing: true,
            behavior: 'When a user acts, something happens.',
            userStory: 'As a user, I can do something.',
            context: 'Implementation context.',
            sourceTestKeys: inputs.map((input) => input.testKey),
          },
        },
      ]),
  }))

  const consolidate = await loadConsolidateModule(`phase2-backcompat-${crypto.randomUUID()}`)
  const progress = createEmptyProgress(1)

  progress.phase1.extractedBehaviors['tests/tools/a.test.ts::suite > case'] = {
    testName: 'case',
    fullPath: 'suite > case',
    behavior: 'When a user targets a group, the bot routes the request correctly.',
    context: 'Routes through group context selection.',
    keywords: ['group-targeting'],
  }

  const manifest = { version: 1 as const, entries: {} }
  const result = await consolidate.runPhase2(progress, manifest, 'phase2-v1')

  expect(Object.keys(result.entries)).toEqual(['group-targeting::feature'])
})

test('runPhase2 splits oversized keyword batches before prompt generation', async () => {
  const capturedBatchSizes: number[] = []
  void mock.module('../../scripts/behavior-audit/consolidate-agent.js', () => ({
    consolidateWithRetry: (
      primaryKeyword: string,
      inputs: readonly { readonly testKey: string }[],
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
          }
        }[]
      | null
    > => {
      capturedBatchSizes.push(inputs.length)
      return Promise.resolve([
        {
          id: `${primaryKeyword}::feature-${capturedBatchSizes.length}`,
          item: {
            featureName: `Feature ${capturedBatchSizes.length}`,
            isUserFacing: true,
            behavior: 'When a user acts, something happens.',
            userStory: 'As a user, I can do something.',
            context: 'Implementation context.',
            sourceTestKeys: inputs.map((input) => input.testKey),
          },
        },
      ])
    },
  }))

  const consolidate = await loadConsolidateModule(`split-batches-${crypto.randomUUID()}`)
  const progress = createEmptyProgress(6)

  for (const suffix of ['one', 'two', 'three', 'four', 'five', 'six'] as const) {
    progress.phase1.extractedBehaviors[`tests/tools/a.test.ts::suite > ${suffix}`] = {
      testName: suffix,
      fullPath: `suite > ${suffix}`,
      behavior: `When a user targets group scenario ${suffix}, the bot routes correctly.`,
      context: `Context ${suffix}.`,
      keywords: ['group-targeting', `secondary-${suffix}`],
    }
  }

  const manifest = { version: 1 as const, entries: {} }
  await consolidate.runPhase2(progress, manifest, 'phase2-v1', new Set())

  expect(capturedBatchSizes.length).toBeGreaterThan(1)
  expect(capturedBatchSizes.every((size) => size < 6)).toBe(true)
})

test('phase2 can emit multiple feature-level stories from one keyword-owned batch', async () => {
  void mock.module('../../scripts/behavior-audit/consolidate-agent.js', () => ({
    consolidateWithRetry: (
      primaryKeyword: string,
      inputs: readonly { readonly testKey: string }[],
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
          }
        }[]
      | null
    > =>
      Promise.resolve(
        inputs.map((input, idx) => ({
          id: `${primaryKeyword}::feature-${idx}`,
          item: {
            featureName: `Feature ${idx}`,
            isUserFacing: true,
            behavior: 'When a user acts, something happens.',
            userStory: `As a user, I can do feature ${idx}.`,
            context: 'Implementation context.',
            sourceTestKeys: [input.testKey],
          },
        })),
      ),
  }))

  const consolidate2 = await loadConsolidateModule(`multi-story-${crypto.randomUUID()}`)
  const progress = createEmptyProgress(2)

  progress.phase1.extractedBehaviors['tests/tools/a.test.ts::suite > one'] = {
    testName: 'one',
    fullPath: 'suite > one',
    behavior: 'When a user targets a group, the bot routes the request correctly.',
    context: 'Routes through group context selection.',
    keywords: ['group-targeting', 'group-routing'],
  }
  progress.phase1.extractedBehaviors['tests/tools/a.test.ts::suite > two'] = {
    testName: 'two',
    fullPath: 'suite > two',
    behavior: 'When a user manages group access, the bot shows authorization state.',
    context: 'Reads group authorization records and formats output.',
    keywords: ['group-targeting', 'group-authorization'],
  }

  const manifest = { version: 1 as const, entries: {} }
  const result = await consolidate2.runPhase2(progress, manifest, 'phase2-v1', new Set())
  expect(Object.keys(result.entries).length).toBeGreaterThan(1)
})

test('runPhase3 reads consolidated batches by primary keyword from manifest entries', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: path.join(reportsDir, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: path.join(reportsDir, 'keyword-vocabulary.json'),
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

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
        isUserFacing: true,
        primaryKeyword: 'group-targeting',
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

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
      CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
      STORIES_DIR: path.join(reportsDir, 'stories'),
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
      KEYWORD_VOCABULARY_PATH: path.join(reportsDir, 'keyword-vocabulary.json'),
      PHASE1_TIMEOUT_MS: 1_200_000,
      PHASE2_TIMEOUT_MS: 300_000,
      PHASE3_TIMEOUT_MS: 600_000,
      MAX_RETRIES: 3,
      RETRY_BACKOFF_MS: [0, 0, 0] as const,
      MAX_STEPS: 20,
      EXCLUDED_PREFIXES: [
        'tests/e2e/',
        'tests/client/',
        'tests/helpers/',
        'tests/scripts/',
        'tests/review-loop/',
        'tests/types/',
      ] as const,
    }))

    const realIncrementalModule = await loadIncrementalModule(`passthrough=${crypto.randomUUID()}`)
    const realProgressModule = await loadProgressModule(`passthrough=${crypto.randomUUID()}`)

    void mock.module('../../scripts/behavior-audit/incremental.js', () => ({
      ...realIncrementalModule,
      collectChangedFiles: (): Promise<readonly string[]> => Promise.resolve([]),
      selectIncrementalWork: (input: SelectIncrementalWorkInput): IncrementalSelection => ({
        phase1SelectedTestKeys: [...input.discoveredTestKeys],
        phase2SelectedTestKeys: [...input.discoveredTestKeys],
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
        'tools::selected-case': {
          consolidatedId: 'tools::selected-case',
          domain: 'tools',
          featureName: 'Selected case',
          sourceTestKeys: ['tests/tools/sample.test.ts::suite > first case'],
          isUserFacing: true,
          primaryKeyword: 'group-targeting' as string | null,
          keywords: ['group-targeting'] as readonly string[],
          sourceDomains: ['tools'] as readonly string[],
          phase2Fingerprint: 'phase2-fp' as string | null,
          lastConsolidatedAt: '2026-04-20T12:00:00.000Z' as string | null,
        },
      },
    }

    let phase3ManifestArg: typeof consolidatedManifest | null = null

    void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
      runPhase2: (): Promise<typeof consolidatedManifest> => Promise.resolve(consolidatedManifest),
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

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: path.join(reportsDir, 'progress.json'),
    INCREMENTAL_MANIFEST_PATH: path.join(reportsDir, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: path.join(reportsDir, 'keyword-vocabulary.json'),
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

  const reset = await loadResetModule(`phase2-reset-${crypto.randomUUID()}`)
  await reset.resetBehaviorAudit('phase2')

  expect(await Bun.file(path.join(reportsDir, 'keyword-vocabulary.json')).exists()).toBe(true)
  expect(await Bun.file(path.join(reportsDir, 'consolidated', 'tools.md')).exists()).toBe(false)
  expect(await Bun.file(path.join(reportsDir, 'stories', 'tools.md')).exists()).toBe(false)
})

test('classified-store round-trips sorted classified behaviors under audit root', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    PROJECT_ROOT: root,
    REPORTS_DIR: path.join(root, 'reports'),
    AUDIT_BEHAVIOR_DIR: auditRoot,
    BEHAVIORS_DIR: path.join(auditRoot, 'behaviors'),
    CLASSIFIED_DIR: path.join(auditRoot, 'classified'),
    CONSOLIDATED_DIR: path.join(auditRoot, 'consolidated'),
    STORIES_DIR: path.join(auditRoot, 'stories'),
    PROGRESS_PATH: path.join(auditRoot, 'progress.json'),
    INCREMENTAL_MANIFEST_PATH: path.join(auditRoot, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(auditRoot, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: path.join(auditRoot, 'keyword-vocabulary.json'),
  }))

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
  expect(loaded?.map((item) => item.behaviorId)).toEqual([
    'tests/tools/sample.test.ts::suite > alpha',
    'tests/tools/sample.test.ts::suite > beta',
  ])
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

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    REPORTS_DIR: path.join(root, 'reports'),
    AUDIT_BEHAVIOR_DIR: auditRoot,
    BEHAVIORS_DIR: path.join(auditRoot, 'behaviors'),
    CLASSIFIED_DIR: classifiedDir,
    CONSOLIDATED_DIR: consolidatedDir,
    STORIES_DIR: storiesDir,
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: path.join(auditRoot, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(auditRoot, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
  }))

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
