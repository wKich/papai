import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type * as EvaluateModule from '../../scripts/behavior-audit/evaluate.js'
import type * as ExtractModule from '../../scripts/behavior-audit/extract.js'
import type { IncrementalManifest, IncrementalSelection } from '../../scripts/behavior-audit/incremental.js'
import type * as IncrementalModule from '../../scripts/behavior-audit/incremental.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import type * as ProgressModule from '../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import type { ParsedTestFile } from '../../scripts/behavior-audit/test-parser.js'

const tempDirs: string[] = []
const originalProcessExit = process.exit.bind(process)

type IncrementalModuleShape = typeof IncrementalModule
type ProgressModuleShape = typeof ProgressModule
type ExtractModuleShape = typeof ExtractModule
type EvaluateModuleShape = typeof EvaluateModule
type SelectIncrementalWorkInput = Parameters<IncrementalModuleShape['selectIncrementalWork']>[0]
type CaptureRunStartResult = ReturnType<IncrementalModuleShape['captureRunStart']>
type ManifestTestEntry = IncrementalManifest['tests'][string]
type MockGenerateTextResult = {
  readonly text: string
  readonly steps: readonly { readonly toolCalls: readonly unknown[] }[]
}
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
    version: 1,
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
  return isObject(value) && hasFunctionProperty(value, 'runPhase2')
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
  readonly selectedTestKeys: ReadonlySet<string>
} {
  return (
    isObject(value) && 'selectedTestKeys' in value && value['selectedTestKeys'] instanceof Set && 'progress' in value
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

function normalizePhase2Call(args: readonly unknown[]): { readonly selectedTestKeys: readonly string[] } {
  const firstArg = args[0]
  if (isPhase2Input(firstArg)) {
    return { selectedTestKeys: [...firstArg.selectedTestKeys].toSorted() }
  }
  return { selectedTestKeys: [] }
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('behavior-audit entrypoint incremental selection', () => {
  let root: string
  let reportsDir: string
  let manifestPath: string
  let progressPath: string
  let loadManifestImpl: () => Promise<IncrementalManifest | null>
  let captureRunStartImpl: (
    manifest: IncrementalManifest,
    currentHead: string,
    startedAt: string,
  ) => { readonly previousLastStartCommit: string | null; readonly updatedManifest: IncrementalManifest }
  let saveManifestCalls: IncrementalManifest[]
  let collectChangedFilesImpl: (previousLastStartCommit: string | null) => Promise<readonly string[]>
  let selectIncrementalWorkImpl: (input: {
    readonly changedFiles: readonly string[]
    readonly previousManifest: IncrementalManifest
    readonly currentPhaseVersions: IncrementalManifest['phaseVersions']
    readonly discoveredTestKeys: readonly string[]
  }) => IncrementalSelection
  let selectIncrementalWorkCalls: readonly {
    readonly changedFiles: readonly string[]
    readonly previousManifest: IncrementalManifest
    readonly currentPhaseVersions: IncrementalManifest['phaseVersions']
    readonly discoveredTestKeys: readonly string[]
  }[]
  let loadProgressImpl: () => Promise<Progress | null>
  let createEmptyProgressCalls: number[]
  let runPhase1Calls: readonly {
    readonly parsedTestKeys: readonly string[]
    readonly selectedTestKeys: readonly string[]
  }[]
  let runPhase2Calls: readonly { readonly selectedTestKeys: readonly string[] }[]

  beforeEach(async () => {
    root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    progressPath = path.join(reportsDir, 'progress.json')
    loadManifestImpl = (): Promise<IncrementalManifest | null> => Promise.resolve(null)
    captureRunStartImpl = (manifest, currentHead, startedAt): CaptureRunStartResult => ({
      previousLastStartCommit: manifest.lastStartCommit,
      updatedManifest: {
        ...manifest,
        lastStartCommit: currentHead,
        lastStartedAt: startedAt,
      },
    })
    saveManifestCalls = []
    collectChangedFilesImpl = (): Promise<readonly string[]> => Promise.resolve([])
    selectIncrementalWorkCalls = []
    selectIncrementalWorkImpl = (input: SelectIncrementalWorkInput): IncrementalSelection => {
      selectIncrementalWorkCalls = [...selectIncrementalWorkCalls, input]
      return {
        phase1SelectedTestKeys: [...input.discoveredTestKeys].toSorted(),
        phase2SelectedTestKeys: [...input.discoveredTestKeys].toSorted(),
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
      STORIES_DIR: path.join(reportsDir, 'stories'),
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      PHASE1_TIMEOUT_MS: 1_200_000,
      PHASE2_TIMEOUT_MS: 600_000,
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
      loadManifest: (): Promise<IncrementalManifest | null> => loadManifestImpl(),
      captureRunStart: (manifest: IncrementalManifest, currentHead: string, startedAt: string): CaptureRunStartResult =>
        captureRunStartImpl(manifest, currentHead, startedAt),
      saveManifest: (manifest: IncrementalManifest): Promise<void> => {
        saveManifestCalls = [...saveManifestCalls, manifest]
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
      runPhase2: (...args: readonly unknown[]): Promise<void> => {
        runPhase2Calls = [...runPhase2Calls, normalizePhase2Call(args)]
        return Promise.resolve()
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
    expect(runPhase2Calls).toEqual([{ selectedTestKeys: expectedKeys }])
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
    expect(runPhase2Calls).toEqual([{ selectedTestKeys: selectedKeys }])
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
    }
    progress.phase2.evaluations[selectedKey] = {
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
  let generateTextCalls: number

  beforeEach(async () => {
    root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    progressPath = path.join(reportsDir, 'progress.json')
    generateTextCalls = 0

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
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): (() => { readonly mocked: true }) => (): { readonly mocked: true } => ({
        mocked: true,
      }),
    }))
    void mock.module('ai', () => ({
      generateText: (): Promise<MockGenerateTextResult> => {
        generateTextCalls += 1
        const result: MockGenerateTextResult = {
          text: JSON.stringify({
            behavior: 'When the selected test runs, the bot returns the extracted behavior.',
            context: 'Calls the extractor and records the result for the selected test only.',
          }),
          steps: [],
        }
        return Promise.resolve(result)
      },
      stepCountIs: (): symbol => Symbol('stepCountIs'),
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

    expect(generateTextCalls).toBe(1)
    expect(Object.keys(progress.phase1.extractedBehaviors)).toEqual([selectedKey])
    expect(progress.phase1.completedTests[testFilePath]).toEqual({ [selectedKey]: 'done' })

    const savedManifest = await readSavedManifest(manifestPath)
    const savedEntry = getManifestEntry(savedManifest, selectedKey)
    expect(savedEntry.phase1Fingerprint).toBeTruthy()
    expect(savedEntry.phase2Fingerprint).toBeNull()
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

describe('behavior-audit phase 2 incremental selection', () => {
  let root: string
  let reportsDir: string
  let manifestPath: string
  let progressPath: string
  let evaluateCalls: number
  let realIncrementalModule: IncrementalModuleShape
  let saveManifestImpl: (manifest: IncrementalManifest) => Promise<void>

  beforeEach(async () => {
    root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    progressPath = path.join(reportsDir, 'progress.json')
    evaluateCalls = 0

    const behaviorsDir = path.join(reportsDir, 'behaviors', 'tools')
    mkdirSync(behaviorsDir, { recursive: true })
    await Bun.write(
      path.join(behaviorsDir, 'sample.test.behaviors.md'),
      [
        '# tests/tools/sample.test.ts',
        '',
        '## Test: "suite > selected case"',
        '',
        '**Behavior:** When the selected behavior runs, the bot returns fresh results.',
        '**Context:** Selected context for phase 2.',
        '',
        '## Test: "suite > unselected case"',
        '',
        '**Behavior:** When the unselected behavior runs, the bot keeps prior results.',
        '**Context:** Unselected context for phase 2.',
        '',
      ].join('\n'),
    )

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
      STORIES_DIR: path.join(reportsDir, 'stories'),
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
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

    realIncrementalModule = await loadIncrementalModule(`real=${crypto.randomUUID()}`)
    saveManifestImpl = (manifest: IncrementalManifest): Promise<void> => realIncrementalModule.saveManifest(manifest)
    const realProgressModule = await loadProgressModule(`real=${crypto.randomUUID()}`)
    void mock.module('../../scripts/behavior-audit/incremental.js', () => ({
      ...realIncrementalModule,
      saveManifest: (manifest: IncrementalManifest): Promise<void> => saveManifestImpl(manifest),
    }))
    void mock.module('../../scripts/behavior-audit/progress.js', () => ({ ...realProgressModule }))
    void mock.module('../../scripts/behavior-audit/evaluate-agent.js', () => ({
      evaluateWithRetry: (): Promise<MockEvaluationResult> => {
        evaluateCalls += 1
        const result: MockEvaluationResult = {
          userStory: 'As a user, I get the selected behavior outcome.',
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

  test('runPhase2 only evaluates selected test keys and writes phase2 fingerprints', async () => {
    const incremental = await loadIncrementalModule(`seed=${crypto.randomUUID()}`)
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedKey = 'tests/tools/sample.test.ts::suite > selected case'
    const unselectedKey = 'tests/tools/sample.test.ts::suite > unselected case'
    const progress = createEmptyProgress(1)

    progress.phase2.evaluations[unselectedKey] = {
      testName: 'suite > unselected case',
      behavior: 'When the unselected behavior runs, the bot keeps prior results.',
      userStory: 'Existing unselected story',
      maria: { discover: 2, use: 2, retain: 2, notes: 'Existing Maria notes' },
      dani: { discover: 2, use: 2, retain: 2, notes: 'Existing Dani notes' },
      viktor: { discover: 2, use: 2, retain: 2, notes: 'Existing Viktor notes' },
      flaws: ['Existing flaw'],
      improvements: ['Existing improvement'],
    }
    progress.phase2.completedBehaviors[unselectedKey] = 'done'

    await incremental.saveManifest({
      ...createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [selectedKey]: {
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > selected case',
          dependencyPaths: ['tests/tools/sample.test.ts', 'src/tools/sample.ts'],
          phase1Fingerprint: 'phase1-selected',
          phase2Fingerprint: null,
          extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: 'old-phase1',
          lastPhase2CompletedAt: null,
        },
        [unselectedKey]: {
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > unselected case',
          dependencyPaths: ['tests/tools/sample.test.ts', 'src/tools/sample.ts'],
          phase1Fingerprint: 'phase1-unselected',
          phase2Fingerprint: 'existing-phase2',
          extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: 'old-phase1',
          lastPhase2CompletedAt: 'old-phase2',
        },
      },
    })

    await evaluate.runPhase2({
      progress,
      selectedTestKeys: new Set([selectedKey]),
    })

    const selectedEvaluation = progress.phase2.evaluations[selectedKey]
    if (selectedEvaluation === undefined) {
      throw new Error('Expected selected evaluation to be stored')
    }
    const unselectedEvaluation = progress.phase2.evaluations[unselectedKey]
    if (unselectedEvaluation === undefined) {
      throw new Error('Expected unselected evaluation to remain stored')
    }
    expect(evaluateCalls).toBe(1)
    expect(progress.phase2.completedBehaviors[selectedKey]).toBe('done')
    expect(selectedEvaluation.userStory).toBe('As a user, I get the selected behavior outcome.')
    expect(unselectedEvaluation.userStory).toBe('Existing unselected story')

    const savedManifest = await readSavedManifest(manifestPath)
    expect(getManifestEntry(savedManifest, selectedKey).phase2Fingerprint).toBeTruthy()
    expect(getManifestEntry(savedManifest, selectedKey).lastPhase2CompletedAt).toBeTruthy()
    expect(getManifestEntry(savedManifest, unselectedKey).phase2Fingerprint).toBe('existing-phase2')

    const storyFileText = await Bun.file(path.join(reportsDir, 'stories', 'tools.md')).text()
    expect(storyFileText).toContain('suite > selected case')
    expect(storyFileText).toContain('suite > unselected case')
  })

  test('runPhase2 saves progress before manifest persistence can fail', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedKey = 'tests/tools/sample.test.ts::suite > selected case'
    const progress = createEmptyProgress(1)

    await realIncrementalModule.saveManifest({
      ...createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [selectedKey]: {
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > selected case',
          dependencyPaths: ['tests/tools/sample.test.ts', 'src/tools/sample.ts'],
          phase1Fingerprint: 'phase1-selected',
          phase2Fingerprint: null,
          extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: 'old-phase1',
          lastPhase2CompletedAt: null,
        },
      },
    })

    saveManifestImpl = async (manifest: IncrementalManifest): Promise<void> => {
      await realIncrementalModule.saveManifest(manifest)
      throw new Error('simulated crash after manifest save')
    }

    await expect(
      evaluate.runPhase2({
        progress,
        selectedTestKeys: new Set([selectedKey]),
      }),
    ).rejects.toThrow('simulated crash after manifest save')

    const progressText = await Bun.file(progressPath).text()
    expect(progressText).toContain('As a user, I get the selected behavior outcome.')
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
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
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
    void mock.module('../../scripts/behavior-audit/evaluate.js', () => ({
      runPhase2: (): Promise<void> => {
        if (shouldInterruptPhase2) {
          throw new Error('simulated interruption after run start')
        }
        return Promise.resolve()
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
