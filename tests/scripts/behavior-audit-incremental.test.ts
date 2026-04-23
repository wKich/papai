import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runBehaviorAudit, type BehaviorAuditDeps } from '../../scripts/behavior-audit.ts'
import type * as IncrementalModule from '../../scripts/behavior-audit/incremental.js'
import type * as ProgressMigrateModule from '../../scripts/behavior-audit/progress-migrate.js'
import { loadProgressModule } from './behavior-audit-integration.support.js'

type ManifestTestEntry = IncrementalModule.IncrementalManifest['tests'][string]

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'behavior-audit-incremental-'))
  tempDirs.push(dir)
  return dir
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isIncrementalModule(value: unknown): value is typeof IncrementalModule {
  return (
    isObject(value) &&
    'createEmptyManifest' in value &&
    typeof value['createEmptyManifest'] === 'function' &&
    'captureRunStart' in value &&
    typeof value['captureRunStart'] === 'function' &&
    'loadManifest' in value &&
    typeof value['loadManifest'] === 'function' &&
    'saveManifest' in value &&
    typeof value['saveManifest'] === 'function' &&
    'combineChangedFileLists' in value &&
    typeof value['combineChangedFileLists'] === 'function' &&
    'collectChangedFiles' in value &&
    typeof value['collectChangedFiles'] === 'function' &&
    'selectIncrementalWork' in value &&
    typeof value['selectIncrementalWork'] === 'function'
  )
}

function isProgressMigrateModule(value: unknown): value is typeof ProgressMigrateModule {
  return (
    isObject(value) && 'validateOrMigrateProgress' in value && typeof value['validateOrMigrateProgress'] === 'function'
  )
}

function isBehaviorAuditModule(value: unknown): value is {
  readonly runBehaviorAudit: () => Promise<void>
} {
  return isObject(value) && 'runBehaviorAudit' in value && typeof value['runBehaviorAudit'] === 'function'
}

async function loadIncrementalModule(): Promise<typeof IncrementalModule> {
  const mod: unknown = await import(`../../scripts/behavior-audit/incremental.js?test=${crypto.randomUUID()}`)
  if (!isIncrementalModule(mod)) throw new Error('Unexpected incremental module shape')
  return mod
}

async function loadProgressMigrateModule(): Promise<typeof ProgressMigrateModule> {
  const mod: unknown = await import(`../../scripts/behavior-audit/progress-migrate.js?test=${crypto.randomUUID()}`)
  if (!isProgressMigrateModule(mod)) throw new Error('Unexpected progress-migrate module shape')
  return mod
}

async function loadBehaviorAuditEntryPoint(tag: string): Promise<void> {
  const mod: unknown = await import(`../../scripts/behavior-audit.ts?test=${tag}`)
  if (!isBehaviorAuditModule(mod)) {
    throw new Error('Unexpected behavior-audit module shape')
  }
  await mod.runBehaviorAudit().catch((error: unknown) => {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
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
    if (errorMessage.length > 0) {
      throw new Error(errorMessage)
    }
    throw new Error(`Command failed: ${command.join(' ')}`)
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

function isSavedManifest(
  value: unknown,
): value is { readonly lastStartCommit: string | null; readonly lastStartedAt: string | null } {
  if (!isObject(value)) {
    return false
  }
  if (!('lastStartCommit' in value) || !('lastStartedAt' in value)) {
    return false
  }

  const lastStartCommit = value['lastStartCommit']
  if (typeof lastStartCommit !== 'string' && lastStartCommit !== null) {
    return false
  }

  const lastStartedAt = value['lastStartedAt']
  if (typeof lastStartedAt !== 'string' && lastStartedAt !== null) {
    return false
  }

  return true
}

function createManifestTestEntry(
  input: Omit<
    ManifestTestEntry,
    | 'phase2aFingerprint'
    | 'behaviorId'
    | 'featureKey'
    | 'extractedArtifactPath'
    | 'classifiedArtifactPath'
    | 'lastPhase2aCompletedAt'
  > &
    Partial<
      Pick<
        ManifestTestEntry,
        | 'phase2aFingerprint'
        | 'behaviorId'
        | 'featureKey'
        | 'extractedArtifactPath'
        | 'classifiedArtifactPath'
        | 'lastPhase2aCompletedAt'
      >
    >,
): ManifestTestEntry {
  return {
    phase2aFingerprint: null,
    behaviorId: null,
    featureKey: null,
    extractedArtifactPath: null,
    classifiedArtifactPath: null,
    lastPhase2aCompletedAt: null,
    ...input,
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('behavior-audit incremental manifest', () => {
  let root: string
  let reportsDir: string
  let manifestPath: string
  let phase1ManifestSnapshot: string | null
  let phase1Calls: number

  beforeEach(() => {
    root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    phase1ManifestSnapshot = null
    phase1Calls = 0

    const testsDir = path.join(root, 'tests', 'tools')
    mkdirSync(testsDir, { recursive: true })
    writeFileSync(path.join(testsDir, 'sample.test.ts'), "test('sample', () => {})\n")

    // This suite intentionally keeps narrow module mocks because it is verifying
    // entrypoint startup behavior that happens during delayed module import.
    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      AUDIT_BEHAVIOR_DIR: path.join(reportsDir, 'audit-behavior'),
      BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
      CLASSIFIED_DIR: path.join(reportsDir, 'classified'),
      CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
      STORIES_DIR: path.join(reportsDir, 'stories'),
      PROGRESS_PATH: path.join(reportsDir, 'progress.json'),
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
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
    void mock.module('../../scripts/behavior-audit/extract.js', () => ({
      runPhase1: async (): Promise<void> => {
        phase1Calls += 1
        phase1ManifestSnapshot = await Bun.file(manifestPath).text()
      },
    }))
    void mock.module('../../scripts/behavior-audit/classify.js', () => ({
      runPhase2a: (): Promise<ReadonlySet<string>> => Promise.resolve(new Set()),
    }))
    void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
      runPhase2b: (): Promise<{ readonly version: 1; readonly entries: Record<string, never> }> =>
        Promise.resolve({
          version: 1,
          entries: {},
        }),
    }))
    void mock.module('../../scripts/behavior-audit/evaluate.js', () => ({
      runPhase3: async (): Promise<void> => {},
    }))
    void mock.module('../../scripts/behavior-audit/report-writer.js', () => ({
      rebuildReportsFromStoredResults: async (): Promise<void> => {},
    }))
  })

  test('createEmptyManifest starts with null lastStartCommit and empty tests', async () => {
    const incremental = await loadIncrementalModule()
    const manifest = incremental.createEmptyManifest()

    expect(manifest.version).toBe(1)
    expect(manifest.lastStartCommit).toBeNull()
    expect(manifest.tests).toEqual({})
  })

  test('loadManifest backfills missing optional fields for older files', async () => {
    const incremental = await loadIncrementalModule()

    await Bun.write(
      manifestPath,
      JSON.stringify({
        version: 1,
      }),
    )

    const loaded = await incremental.loadManifest()

    expect(loaded).not.toBeNull()
    if (loaded === null) throw new Error('Expected manifest to load')

    expect(loaded.lastStartCommit).toBeNull()
    expect(loaded.lastStartedAt).toBeNull()
    expect(loaded.lastCompletedAt).toBeNull()
    expect(loaded.phaseVersions).toEqual({ phase1: '', phase2: '', reports: '' })
    expect(loaded.tests).toEqual({})
  })

  test('loadManifest accepts legacy alias fields but returns canonical entries only', async () => {
    const incremental = await loadIncrementalModule()

    await Bun.write(
      manifestPath,
      JSON.stringify({
        version: 1,
        tests: {
          'tests/tools/create-task.test.ts::suite > case': {
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'phase1-fingerprint',
            phase2Fingerprint: 'phase2-fingerprint',
            behaviorId: 'behavior-1',
            candidateFeatureKey: 'task-creation',
            extractedBehaviorPath: 'reports/audit-behavior/extracted/tools/create-task.test.json',
            classifiedArtifactPath: 'reports/audit-behavior/classified/tools/create-task.test.json',
            domain: 'tools',
            lastPhase1CompletedAt: '2026-04-23T12:00:00.000Z',
            lastPhase2CompletedAt: '2026-04-23T12:05:00.000Z',
          },
        },
      }),
    )

    const loaded = await incremental.loadManifest()

    expect(loaded).not.toBeNull()
    if (loaded === null) throw new Error('Expected manifest to load')

    const entry = loaded.tests['tests/tools/create-task.test.ts::suite > case']
    expect(entry).toBeDefined()
    expect(entry?.featureKey).toBe('task-creation')
    expect(entry?.extractedArtifactPath).toBe('reports/audit-behavior/extracted/tools/create-task.test.json')
    expect(entry).not.toHaveProperty('candidateFeatureKey')
    expect(entry).not.toHaveProperty('extractedBehaviorPath')
  })

  test('loadConsolidatedManifest accepts legacy alias fields but returns canonical entries only', async () => {
    const incremental = await loadIncrementalModule()
    const consolidatedManifestPath = path.join(reportsDir, 'consolidated-manifest.json')

    await Bun.write(
      consolidatedManifestPath,
      JSON.stringify({
        version: 1,
        entries: {
          'task-creation::task-creation': {
            consolidatedId: 'task-creation::task-creation',
            domain: 'tools',
            featureName: 'Task creation',
            consolidatedArtifactPath: 'reports/audit-behavior/consolidated/task-creation.json',
            evaluatedArtifactPath: 'reports/audit-behavior/evaluated/task-creation.json',
            sourceTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
            sourceBehaviorIds: ['behavior-1'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            candidateFeatureKey: 'task-creation',
            keywords: ['task-create'],
            sourceDomains: ['tools'],
            phase2Fingerprint: 'phase2-fingerprint',
            lastConsolidatedAt: '2026-04-23T12:10:00.000Z',
            lastEvaluatedAt: '2026-04-23T12:15:00.000Z',
          },
        },
      }),
    )

    const loaded = await incremental.loadConsolidatedManifest()

    expect(loaded).not.toBeNull()
    if (loaded === null) throw new Error('Expected consolidated manifest to load')

    const entry = loaded.entries['task-creation::task-creation']
    expect(entry).toBeDefined()
    expect(entry?.featureKey).toBe('task-creation')
    expect(entry).not.toHaveProperty('candidateFeatureKey')
  })

  test('loadManifest throws when manifest content is malformed', async () => {
    const incremental = await loadIncrementalModule()

    await Bun.write(manifestPath, '{not valid json')

    await expect(incremental.loadManifest()).rejects.toThrow()
  })

  test('loadManifest throws when manifest JSON is schema-invalid', async () => {
    const incremental = await loadIncrementalModule()

    await Bun.write(
      manifestPath,
      JSON.stringify({
        version: 2,
        tests: {},
      }),
    )

    await expect(incremental.loadManifest()).rejects.toThrow()
  })

  test('captureRunStart saves previous lastStartCommit for diffing and writes new HEAD immediately', async () => {
    const incremental = await loadIncrementalModule()
    const manifest = {
      ...incremental.createEmptyManifest(),
      lastStartCommit: 'old-commit',
    }

    const result = incremental.captureRunStart(manifest, 'new-commit', '2026-04-17T12:00:00.000Z')

    expect(result.previousLastStartCommit).toBe('old-commit')
    expect(result.updatedManifest.lastStartCommit).toBe('new-commit')
    expect(result.updatedManifest.lastStartedAt).toBe('2026-04-17T12:00:00.000Z')
  })

  test('combineChangedFileLists unions and sorts paths deterministically', async () => {
    const incremental = await loadIncrementalModule()

    const paths = incremental.combineChangedFileLists([
      ['tests/tools/a.test.ts', 'src/tools/a.ts'],
      ['src/tools/a.ts', 'scripts/behavior-audit/evaluate.ts'],
      [],
      ['new-file.ts'],
    ])

    expect(paths).toEqual([
      'new-file.ts',
      'scripts/behavior-audit/evaluate.ts',
      'src/tools/a.ts',
      'tests/tools/a.test.ts',
    ])
  })

  test('collectChangedFiles unions committed, staged, unstaged, and untracked paths', async () => {
    const incremental = await loadIncrementalModule()
    await initializeGitRepo(root)

    const committedPath = path.join(root, 'committed.ts')
    const stagedPath = path.join(root, 'staged.ts')
    const unstagedPath = path.join(root, 'unstaged.ts')
    writeFileSync(committedPath, 'export const committed = 1\n')
    writeFileSync(stagedPath, 'export const staged = 1\n')
    writeFileSync(unstagedPath, 'export const unstaged = 1\n')
    await commitAll(root, 'seed tracked files')

    const previousLastStartCommit = await runCommand(['git', 'rev-parse', 'HEAD'], root)

    writeFileSync(committedPath, 'export const committed = 2\n')
    await commitAll(root, 'commit tracked change')

    writeFileSync(stagedPath, 'export const staged = 2\n')
    await runCommand(['git', 'add', 'staged.ts'], root)

    writeFileSync(unstagedPath, 'export const unstaged = 2\n')

    writeFileSync(path.join(root, 'untracked.ts'), 'export const untracked = 1\n')

    const changedFiles = await incremental.collectChangedFiles(previousLastStartCommit)

    expect(changedFiles).toEqual(['committed.ts', 'staged.ts', 'unstaged.ts', 'untracked.ts'])
  })

  test('collectChangedFiles skips committed diff when previousLastStartCommit is null', async () => {
    const incremental = await loadIncrementalModule()
    await initializeGitRepo(root)

    writeFileSync(path.join(root, 'tracked.ts'), 'export const tracked = 1\n')
    await commitAll(root, 'seed tracked file')

    writeFileSync(path.join(root, 'committed-only.ts'), 'export const committedOnly = 1\n')
    await commitAll(root, 'commit without baseline')

    writeFileSync(path.join(root, 'staged-only.ts'), 'export const stagedOnly = 1\n')
    await runCommand(['git', 'add', 'staged-only.ts'], root)

    writeFileSync(path.join(root, 'unstaged-only.ts'), 'export const unstagedOnly = 1\n')
    writeFileSync(path.join(root, 'untracked-only.ts'), 'export const untrackedOnly = 1\n')

    const changedFiles = await incremental.collectChangedFiles(null)

    expect(changedFiles).toEqual(['staged-only.ts', 'unstaged-only.ts', 'untracked-only.ts'])
  })

  test('collectChangedFiles preserves literal filenames with newlines', async () => {
    const incremental = await loadIncrementalModule()
    await initializeGitRepo(root)

    const committedName = 'committed\nname.ts'
    const stagedName = 'staged\nname.ts'
    const unstagedName = 'unstaged\nname.ts'
    const untrackedName = 'untracked\nname.ts'

    writeFileSync(path.join(root, committedName), 'export const committed = 1\n')
    writeFileSync(path.join(root, stagedName), 'export const staged = 1\n')
    writeFileSync(path.join(root, unstagedName), 'export const unstaged = 1\n')
    await commitAll(root, 'seed tracked files with newline names')

    const previousLastStartCommit = await runCommand(['git', 'rev-parse', 'HEAD'], root)

    writeFileSync(path.join(root, committedName), 'export const committed = 2\n')
    await commitAll(root, 'commit tracked newline name change')

    writeFileSync(path.join(root, stagedName), 'export const staged = 2\n')
    await runCommand(['git', 'add', stagedName], root)

    writeFileSync(path.join(root, unstagedName), 'export const unstaged = 2\n')

    writeFileSync(path.join(root, untrackedName), 'export const untracked = 1\n')

    const changedFiles = await incremental.collectChangedFiles(previousLastStartCommit)

    expect(changedFiles).toEqual([committedName, stagedName, unstagedName, untrackedName].toSorted())
  })

  test('buildPhase1Fingerprint changes when mirrored source hash changes', async () => {
    const incremental = await loadIncrementalModule()

    const a = incremental.buildPhase1Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      testFileHash: 'test-hash',
      testSource: 'it(...)',
      mirroredSourceHash: 'src-a',
      phaseVersion: 'v1',
    })
    const b = incremental.buildPhase1Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      testFileHash: 'test-hash',
      testSource: 'it(...)',
      mirroredSourceHash: 'src-b',
      phaseVersion: 'v1',
    })

    expect(a).not.toBe(b)
  })

  test('buildPhase2Fingerprint changes when extracted context changes', async () => {
    const incremental = await loadIncrementalModule()

    const a = incremental.buildPhase2Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls createTask and persists provider output.',
      keywords: ['task-create'],
      phaseVersion: 'v1',
    })
    const b = incremental.buildPhase2Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls createTask, enriches metadata, and persists provider output.',
      keywords: ['task-create'],
      phaseVersion: 'v1',
    })

    expect(a).not.toBe(b)
  })

  test('selectIncrementalWork marks Phase 1 and Phase 2 when a dependency path changed', async () => {
    const incremental = await loadIncrementalModule()

    const selection = incremental.selectIncrementalWork({
      changedFiles: ['src/tools/create-task.ts'],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
        tests: {
          'tests/tools/create-task.test.ts::suite > case': createManifestTestEntry({
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedArtifactPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          }),
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
      previousConsolidatedManifest: null,
    })

    expect(selection.phase1SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2bSelectedFeatureKeys).toEqual([])
    expect(selection.phase3SelectedConsolidatedIds).toEqual([])
    expect(selection.reportRebuildOnly).toBe(false)
  })

  test('selectIncrementalWork reruns only Phase 2 when only the Phase 2 version changed', async () => {
    const incremental = await loadIncrementalModule()

    const selection = incremental.selectIncrementalWork({
      changedFiles: [],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2-old', reports: 'r1' },
        tests: {
          'tests/tools/create-task.test.ts::suite > case': createManifestTestEntry({
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedArtifactPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          }),
          'tests/tools/no-behavior.test.ts::suite > pending': createManifestTestEntry({
            testFile: 'tests/tools/no-behavior.test.ts',
            testName: 'suite > pending',
            dependencyPaths: ['tests/tools/no-behavior.test.ts'],
            phase1Fingerprint: 'fp3',
            phase2Fingerprint: null,
            extractedArtifactPath: null,
            domain: 'tools',
            lastPhase1CompletedAt: null,
            lastPhase2CompletedAt: null,
          }),
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2-new', reports: 'r1' },
      discoveredTestKeys: [
        'tests/tools/create-task.test.ts::suite > case',
        'tests/tools/no-behavior.test.ts::suite > pending',
      ],
      previousConsolidatedManifest: null,
    })

    expect(selection.phase1SelectedTestKeys).toEqual([])
    expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2bSelectedFeatureKeys).toEqual([])
    expect(selection.phase3SelectedConsolidatedIds).toEqual([])
    expect(selection.reportRebuildOnly).toBe(false)
  })

  test('selectIncrementalWork reports rebuild only when only the report version changed', async () => {
    const incremental = await loadIncrementalModule()

    const selection = incremental.selectIncrementalWork({
      changedFiles: [],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1-old' },
        tests: {
          'tests/tools/create-task.test.ts::suite > case': createManifestTestEntry({
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedArtifactPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          }),
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1-new' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
      previousConsolidatedManifest: null,
    })

    expect(selection.phase1SelectedTestKeys).toEqual([])
    expect(selection.phase2aSelectedTestKeys).toEqual([])
    expect(selection.phase2bSelectedFeatureKeys).toEqual([])
    expect(selection.phase3SelectedConsolidatedIds).toEqual([])
    expect(selection.reportRebuildOnly).toBe(true)
  })

  test('selectIncrementalWork selects newly discovered tests for both phases', async () => {
    const incremental = await loadIncrementalModule()

    const selection = incremental.selectIncrementalWork({
      changedFiles: [],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
        tests: {},
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > new case'],
      previousConsolidatedManifest: null,
    })

    expect(selection.phase1SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > new case'])
    expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > new case'])
    expect(selection.phase2bSelectedFeatureKeys).toEqual([])
    expect(selection.phase3SelectedConsolidatedIds).toEqual([])
    expect(selection.reportRebuildOnly).toBe(false)
  })

  test('selectIncrementalWork selects all consolidated ids when phase1 changes may produce new consolidated ids', async () => {
    const incremental = await loadIncrementalModule()

    const previousConsolidatedManifest: IncrementalModule.ConsolidatedManifest = {
      version: 1,
      entries: {
        'tools::old-feature': {
          consolidatedId: 'tools::old-feature',
          domain: 'tools',
          featureName: 'Old feature',
          sourceTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
          sourceBehaviorIds: ['tests/tools/create-task.test.ts::suite > case'],
          supportingInternalBehaviorIds: [],
          isUserFacing: true,
          featureKey: null,
          keywords: ['old-keyword'],
          sourceDomains: ['tools'],
          phase2Fingerprint: 'fp',
          lastConsolidatedAt: '2026-04-20T12:00:00.000Z',
        },
      },
    }

    const selection = incremental.selectIncrementalWork({
      changedFiles: ['src/tools/create-task.ts'],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
        tests: {
          'tests/tools/create-task.test.ts::suite > case': createManifestTestEntry({
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedArtifactPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          }),
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
      previousConsolidatedManifest,
    })

    expect(selection.phase1SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2bSelectedFeatureKeys).toEqual([])
    expect(selection.phase3SelectedConsolidatedIds).toEqual(['tools::old-feature'])
    expect(selection.reportRebuildOnly).toBe(false)
  })

  test('selectIncrementalWork selects affected feature keys when phase2a metadata changed', async () => {
    const incremental = await loadIncrementalModule()

    const selection = incremental.selectIncrementalWork({
      changedFiles: ['src/tools/create-task.ts'],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
        tests: {
          'tests/tools/create-task.test.ts::suite > case': createManifestTestEntry({
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2aFingerprint: 'fp2a',
            phase2Fingerprint: 'fp2b',
            behaviorId: 'tests/tools/create-task.test.ts::suite > case',
            featureKey: 'task-creation',
            extractedArtifactPath: 'reports/audit-behavior/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2aCompletedAt: 'y',
            lastPhase2CompletedAt: 'z',
          }),
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
      previousConsolidatedManifest: {
        version: 1,
        entries: {
          'task-creation::task-creation': {
            consolidatedId: 'task-creation::task-creation',
            domain: 'tools',
            featureName: 'Task creation',
            sourceTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
            sourceBehaviorIds: ['tests/tools/create-task.test.ts::suite > case'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            featureKey: 'task-creation',
            keywords: ['task-create'],
            sourceDomains: ['tools'],
            phase2Fingerprint: 'fp',
            lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
          },
        },
      },
    })

    expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2bSelectedFeatureKeys).toEqual(['task-creation'])
    expect(selection.phase3SelectedConsolidatedIds).toEqual(['task-creation::task-creation'])
  })

  test('saveManifest writes through a temp file and atomically renames it into place', async () => {
    const renameSpy = spyOn(fsPromises, 'rename')
    const incremental = await loadIncrementalModule()

    await incremental.saveManifest(incremental.createEmptyManifest())

    const reportEntries = readdirSync(reportsDir)
    expect(reportEntries).toEqual(['incremental-manifest.json'])
    expect(renameSpy).toHaveBeenCalledTimes(1)
    const firstRenameCall = renameSpy.mock.calls[0]
    if (firstRenameCall === undefined) {
      throw new Error('Expected rename to be called')
    }
    expect(firstRenameCall[0]).not.toBe(manifestPath)
    expect(firstRenameCall[1]).toBe(manifestPath)
  })

  test('startup writes lastStartCommit to the manifest before phase execution', async () => {
    await initializeGitRepo(root)
    const currentHead = await runCommand(['git', 'rev-parse', 'HEAD'], root)

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    const savedManifestJson: unknown = JSON.parse(await Bun.file(manifestPath).text())
    if (!isSavedManifest(savedManifestJson)) {
      throw new Error('Saved manifest shape mismatch')
    }

    expect(savedManifestJson.lastStartCommit).toBe(currentHead)
    expect(savedManifestJson.lastStartedAt).not.toBeNull()
    expect(phase1Calls).toBe(1)
    expect(phase1ManifestSnapshot).not.toBeNull()
    if (phase1ManifestSnapshot === null) {
      throw new Error('Expected phase1 manifest snapshot')
    }
    expect(JSON.parse(phase1ManifestSnapshot)).toMatchObject({
      lastStartCommit: currentHead,
    })
  })

  test('startup stops on corrupt manifest before overwriting it', async () => {
    await initializeGitRepo(root)

    await Bun.write(manifestPath, '{broken json')

    const errorCalls: string[] = []
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args: readonly unknown[]) => {
      errorCalls.push(args.map(String).join(' '))
    })
    const processExitSpy = spyOn(process, 'exit').mockImplementation(((code: number | undefined) => {
      if (code === undefined) {
        throw new Error('process.exit:0')
      }
      throw new Error(`process.exit:${code}`)
    }) as typeof process.exit)

    await expect(loadBehaviorAuditEntryPoint(crypto.randomUUID())).rejects.toThrow('process.exit:1')
    expect(await Bun.file(manifestPath).text()).toBe('{broken json')
    expect(errorCalls.some((line) => line.includes('Fatal error:'))).toBe(true)
    expect(phase1Calls).toBe(0)

    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  test('startup stops on schema-invalid manifest before overwriting it', async () => {
    await initializeGitRepo(root)

    await Bun.write(
      manifestPath,
      JSON.stringify({
        version: 2,
        tests: {},
      }),
    )

    const errorCalls: string[] = []
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args: readonly unknown[]) => {
      errorCalls.push(args.map(String).join(' '))
    })
    const processExitSpy = spyOn(process, 'exit').mockImplementation(((code: number | undefined) => {
      if (code === undefined) {
        throw new Error('process.exit:0')
      }
      throw new Error(`process.exit:${code}`)
    }) as typeof process.exit)

    await expect(loadBehaviorAuditEntryPoint(crypto.randomUUID())).rejects.toThrow('process.exit:1')
    expect(await Bun.file(manifestPath).text()).toBe('{"version":2,"tests":{}}')
    expect(errorCalls.some((line) => line.includes('Fatal error:'))).toBe(true)
    expect(phase1Calls).toBe(0)

    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  test('buildPhase2Fingerprint changes when canonical keywords change', async () => {
    const incremental = await loadIncrementalModule()

    const a = incremental.buildPhase2Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls createTask and persists provider output.',
      keywords: ['task-create', 'task-save'],
      phaseVersion: 'v1',
    })
    const b = incremental.buildPhase2Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls createTask and persists provider output.',
      keywords: ['task-create', 'task-persist'],
      phaseVersion: 'v1',
    })

    expect(a).not.toBe(b)
  })

  test('validateOrMigrateProgress upgrades version 2 progress into checkpoint-only version 4 state', async () => {
    const mod = await loadProgressMigrateModule()

    const migrated = mod.validateOrMigrateProgress({
      version: 2,
      startedAt: '2026-04-21T12:00:00.000Z',
      phase1: {
        status: 'done',
        completedTests: {},
        extractedBehaviors: {},
        failedTests: {},
        completedFiles: [],
        stats: { filesTotal: 1, filesDone: 1, testsExtracted: 1, testsFailed: 0 },
      },
      phase2: {
        status: 'done',
        completedBatches: {},
        consolidations: {},
        failedBatches: {},
        stats: { batchesTotal: 0, batchesDone: 0, batchesFailed: 0, behaviorsConsolidated: 0 },
      },
      phase3: {
        status: 'done',
        completedBehaviors: {},
        evaluations: {},
        failedBehaviors: {},
        stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
      },
    })

    expect(migrated?.version).toBe(4)
    expect(migrated?.phase1.status).toBe('not-started')
    expect(migrated?.phase1.completedTests).toEqual({})
    expect(migrated?.phase1.completedFiles).toEqual([])
    expect(migrated?.phase1.stats).toEqual({ filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 })
    expect(migrated?.phase2a.status).toBe('not-started')
    expect(migrated?.phase2b.status).toBe('not-started')
    expect(migrated?.phase3.status).toBe('not-started')
  })

  test('createEmptyProgress returns checkpoint-only version 4 progress', async () => {
    const mod = await loadProgressModule(crypto.randomUUID())
    const progress = mod.createEmptyProgress(2)

    expect(progress.version).toBe(4)
    expect(progress.phase1).not.toHaveProperty('extractedBehaviors')
    expect(progress.phase2a).not.toHaveProperty('classifiedBehaviors')
    expect(progress.phase2b).not.toHaveProperty('consolidations')
    expect(progress.phase3).not.toHaveProperty('evaluations')
  })

  test('validateOrMigrateProgress normalizes payload-heavy version 3 files into checkpoint-only version 4 progress', async () => {
    const mod = await loadProgressMigrateModule()

    const migrated = mod.validateOrMigrateProgress({
      version: 3,
      startedAt: '2026-04-21T12:00:00.000Z',
      phase1: {
        status: 'done',
        completedTests: {
          'tests/tools/create-task.test.ts': {
            'tests/tools/create-task.test.ts::suite > case': 'done',
          },
        },
        extractedBehaviors: {
          'tests/tools/create-task.test.ts::suite > case': {
            testName: 'suite > case',
            fullPath: 'suite > case',
            behavior: 'Creates a task for the user.',
            context: 'Calls provider createTask.',
            keywords: ['task-create'],
          },
        },
        failedTests: {},
        completedFiles: ['tests/tools/create-task.test.ts'],
        stats: { filesTotal: 1, filesDone: 1, testsExtracted: 1, testsFailed: 0 },
      },
      phase2a: {
        status: 'done',
        completedBehaviors: { 'tests/tools/create-task.test.ts::suite > case': 'done' },
        classifiedBehaviors: {
          'tests/tools/create-task.test.ts::suite > case': {
            behaviorId: 'tests/tools/create-task.test.ts::suite > case',
            testKey: 'tests/tools/create-task.test.ts::suite > case',
            domain: 'tools',
            behavior: 'Creates a task for the user.',
            context: 'Calls provider createTask.',
            keywords: ['task-create'],
            visibility: 'user-facing',
            featureKey: 'task-creation',
            candidateFeatureLabel: 'Task creation',
            supportingBehaviorRefs: [],
            relatedBehaviorHints: [],
            classificationNotes: 'clear primary workflow',
          },
        },
        failedBehaviors: {},
        stats: { behaviorsTotal: 1, behaviorsDone: 1, behaviorsFailed: 0 },
      },
      phase2b: {
        status: 'done',
        completedCandidateFeatures: { 'task-creation': 'done' },
        consolidations: {
          'task-creation': [
            {
              id: 'task-creation::task-creation',
              domain: 'tools',
              featureName: 'Task creation',
              isUserFacing: true,
              behavior: 'Creates a task for the user.',
              userStory: 'As a user, I can create a task.',
              context: 'Calls provider createTask.',
              sourceTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
              sourceBehaviorIds: ['tests/tools/create-task.test.ts::suite > case'],
              supportingInternalRefs: [],
            },
          ],
        },
        failedCandidateFeatures: {},
        stats: {
          candidateFeaturesTotal: 1,
          candidateFeaturesDone: 1,
          candidateFeaturesFailed: 0,
          behaviorsConsolidated: 1,
        },
      },
      phase3: {
        status: 'done',
        completedBehaviors: { 'task-creation::task-creation': 'done' },
        evaluations: {
          'task-creation::task-creation': {
            testName: 'suite > case',
            behavior: 'Creates a task for the user.',
            userStory: 'As a user, I can create a task.',
            maria: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            dani: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            viktor: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            flaws: [],
            improvements: [],
          },
        },
        failedBehaviors: {},
        stats: { behaviorsTotal: 1, behaviorsDone: 1, behaviorsFailed: 0 },
      },
    })

    expect(migrated?.version).toBe(4)
    expect(migrated?.phase1.status).toBe('not-started')
    expect(migrated?.phase1.completedFiles).toEqual([])
    expect(migrated?.phase1.completedTests).toEqual({})
    expect(migrated?.phase1.stats).toEqual({ filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 })
    expect(migrated?.phase1).not.toHaveProperty('extractedBehaviors')
    expect(migrated?.phase2a.status).toBe('not-started')
    expect(migrated?.phase2a).not.toHaveProperty('classifiedBehaviors')
    expect(migrated?.phase2b.status).toBe('not-started')
    expect(migrated?.phase2b).not.toHaveProperty('consolidations')
    expect(migrated?.phase3.status).toBe('not-started')
    expect(migrated?.phase3).not.toHaveProperty('evaluations')
  })

  test('validateOrMigrateProgress treats populated legacy version 2 consolidations as incompatible and keeps only safe phase1 checkpoints', async () => {
    const mod = await loadProgressMigrateModule()

    const migrated = mod.validateOrMigrateProgress({
      version: 2,
      startedAt: '2026-04-21T12:00:00.000Z',
      phase1: {
        status: 'done',
        completedTests: {
          'tests/tools/create-task.test.ts': { 'tests/tools/create-task.test.ts::suite > case': 'done' },
        },
        extractedBehaviors: {
          'tests/tools/create-task.test.ts::suite > case': {
            testName: 'suite > case',
            fullPath: 'suite > case',
            behavior: 'Creates a task for the user.',
            context: 'Calls provider createTask.',
            keywords: ['task-create'],
          },
        },
        failedTests: {},
        completedFiles: ['tests/tools/create-task.test.ts'],
        stats: { filesTotal: 1, filesDone: 1, testsExtracted: 1, testsFailed: 0 },
      },
      phase2: {
        status: 'done',
        completedBatches: { tools: 'done' },
        consolidations: {
          tools: [
            {
              id: 'tools::create-task',
              domain: 'tools',
              featureName: 'Create task',
              isUserFacing: true,
              behavior: 'Creates a task for the user.',
              userStory: 'As a user, I can create a task.',
              context: 'Calls provider createTask.',
              sourceTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
            },
          ],
        },
        failedBatches: {},
        stats: { batchesTotal: 1, batchesDone: 1, batchesFailed: 0, behaviorsConsolidated: 1 },
      },
      phase3: {
        status: 'done',
        completedBehaviors: {},
        evaluations: {},
        failedBehaviors: {},
        stats: { behaviorsTotal: 1, behaviorsDone: 1, behaviorsFailed: 0 },
      },
    })

    expect(migrated?.version).toBe(4)
    expect(migrated?.phase1.status).toBe('not-started')
    expect(migrated?.phase1.completedFiles).toEqual([])
    expect(migrated?.phase1.completedTests).toEqual({})
    expect(migrated?.phase1.stats).toEqual({ filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 })
    expect(migrated?.phase1).not.toHaveProperty('extractedBehaviors')
    expect(migrated?.phase2a.status).toBe('not-started')
    expect(migrated?.phase2b.status).toBe('not-started')
    expect(migrated?.phase3.status).toBe('not-started')
  })

  test('validateOrMigrateProgress resets pre-versioned payload-heavy phase1 state to a clean checkpoint-only baseline', async () => {
    const mod = await loadProgressMigrateModule()

    const migrated = mod.validateOrMigrateProgress({
      startedAt: '2026-04-21T12:00:00.000Z',
      phase1: {
        status: 'in-progress',
        completedTests: {
          'tests/tools/create-task.test.ts': {
            'tests/tools/create-task.test.ts::suite > case': 'done',
          },
        },
        extractedBehaviors: {
          'tests/tools/create-task.test.ts::suite > case': {
            testName: 'suite > case',
            fullPath: 'suite > case',
            behavior: 'Creates a task for the user.',
            context: 'Calls provider createTask.',
            keywords: ['task-create'],
          },
        },
        failedTests: {},
        completedFiles: ['tests/tools/create-task.test.ts'],
        stats: { filesTotal: 3, filesDone: 1, testsExtracted: 1, testsFailed: 0 },
      },
      phase2: {
        ignored: true,
      },
    })

    expect(migrated?.version).toBe(4)
    expect(migrated?.phase1.status).toBe('not-started')
    expect(migrated?.phase1.completedTests).toEqual({})
    expect(migrated?.phase1.completedFiles).toEqual([])
    expect(migrated?.phase1.stats).toEqual({ filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 })
    expect(migrated?.phase2a.status).toBe('not-started')
    expect(migrated?.phase2b.status).toBe('not-started')
    expect(migrated?.phase3.status).toBe('not-started')
  })

  test('validateOrMigrateProgress treats populated legacy pre-versioned phase1 state as incompatible and resets it', async () => {
    const mod = await loadProgressMigrateModule()

    const migrated = mod.validateOrMigrateProgress({
      startedAt: '2026-04-21T12:00:00.000Z',
      phase1: {
        status: 'in-progress',
        completedTests: {
          'tests/tools/create-task.test.ts': {
            'tests/tools/create-task.test.ts::suite > case': 'done',
          },
        },
        extractedBehaviors: {},
        failedTests: {},
        completedFiles: ['tests/tools/create-task.test.ts'],
        stats: { filesTotal: 3, filesDone: 1, testsExtracted: 1, testsFailed: 0 },
      },
      phase2: {
        ignored: true,
      },
    })

    expect(migrated?.version).toBe(4)
    expect(migrated?.phase1.status).toBe('not-started')
    expect(migrated?.phase1.completedTests).toEqual({})
    expect(migrated?.phase1.completedFiles).toEqual([])
    expect(migrated?.phase1.stats).toEqual({ filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 })
    expect(migrated?.phase2a.status).toBe('not-started')
    expect(migrated?.phase2b.status).toBe('not-started')
    expect(migrated?.phase3.status).toBe('not-started')
  })

  test('validateOrMigrateProgress resets legacy pre-versioned phase1 state when startedAt is missing', async () => {
    const mod = await loadProgressMigrateModule()

    const makeLegacyInput = (): {
      readonly phase1: {
        readonly status: 'done'
        readonly completedTests: Record<string, Record<string, 'done'>>
        readonly extractedBehaviors: Record<string, never>
        readonly failedTests: Record<string, never>
        readonly completedFiles: readonly string[]
        readonly stats: {
          readonly filesTotal: number
          readonly filesDone: number
          readonly testsExtracted: number
          readonly testsFailed: number
        }
      }
      readonly phase2: Record<string, never>
    } => ({
      phase1: {
        status: 'done',
        completedTests: {
          'tests/tools/create-task.test.ts': {
            'tests/tools/create-task.test.ts::suite > case': 'done',
          },
        },
        extractedBehaviors: {},
        failedTests: {},
        completedFiles: ['tests/tools/create-task.test.ts'],
        stats: { filesTotal: 2, filesDone: 1, testsExtracted: 1, testsFailed: 0 },
      },
      phase2: {},
    })

    const migrated = mod.validateOrMigrateProgress(makeLegacyInput())
    await Bun.sleep(10)
    const migratedAgain = mod.validateOrMigrateProgress(makeLegacyInput())

    expect(migrated?.version).toBe(4)
    expect(typeof migrated?.startedAt).toBe('string')
    expect(migrated?.startedAt.length).toBeGreaterThan(0)
    expect(typeof migratedAgain?.startedAt).toBe('string')
    expect(migratedAgain?.startedAt.length).toBeGreaterThan(0)
    expect(migrated?.startedAt).not.toBe(migratedAgain?.startedAt)
    expect(migrated?.phase1.status).toBe('not-started')
    expect(migrated?.phase1.completedTests).toEqual({})
    expect(migrated?.phase1.completedFiles).toEqual([])
    expect(migrated?.phase1.stats).toEqual({ filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 })
    expect(migrated?.phase2a.status).toBe('not-started')
    expect(migrated?.phase2b.status).toBe('not-started')
    expect(migrated?.phase3.status).toBe('not-started')
  })

  test('validateOrMigrateProgress resets payload-heavy version 3 phase2a failure state to checkpoint-only defaults', async () => {
    const mod = await loadProgressMigrateModule()

    const migrated = mod.validateOrMigrateProgress({
      version: 3,
      startedAt: '2026-04-21T12:00:00.000Z',
      phase1: {
        status: 'done',
        completedTests: {},
        extractedBehaviors: {
          'tests/tools/create-task.test.ts::suite > case': {
            testName: 'suite > case',
            fullPath: 'suite > case',
            behavior: 'Creates a task for the user.',
            context: 'Calls provider createTask.',
            keywords: ['task-create'],
          },
        },
        failedTests: {},
        completedFiles: ['tests/tools/create-task.test.ts'],
        stats: { filesTotal: 1, filesDone: 1, testsExtracted: 1, testsFailed: 0 },
      },
      phase2a: {
        status: 'done',
        completedBehaviors: {},
        classifiedBehaviors: {},
        failedBehaviors: {
          'tests/tools/create-task.test.ts::suite > case': {
            error: 'classification failed after retries',
            attempts: 1,
            lastAttempt: '2026-04-21T12:05:00.000Z',
          },
        },
        stats: { behaviorsTotal: 1, behaviorsDone: 0, behaviorsFailed: 1 },
      },
      phase2b: {
        status: 'not-started',
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
        status: 'not-started',
        completedBehaviors: {},
        evaluations: {},
        failedBehaviors: {},
        stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
      },
    })

    expect(migrated?.version).toBe(4)
    expect(migrated?.phase2a.status).toBe('not-started')
    expect(migrated?.phase2a.failedBehaviors).toEqual({})
    expect(migrated?.phase2a.stats).toEqual({ behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 })
  })

  test('startup passes changed tests through phase2a and phase2b without touching unrelated candidate features', async () => {
    const calls: { readonly phase2a: readonly string[]; readonly phase2b: readonly string[] }[] = []

    const deps: BehaviorAuditDeps = {
      requireOpenAiApiKey: () => {},
      prepareIncrementalRun: () =>
        Promise.resolve({
          previousManifest: {
            version: 1,
            lastStartCommit: null,
            lastStartedAt: null,
            lastCompletedAt: null,
            phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
            tests: {},
          },
          previousLastStartCommit: null,
          updatedManifest: {
            version: 1,
            lastStartCommit: 'head-1',
            lastStartedAt: '2026-04-22T12:00:00.000Z',
            lastCompletedAt: null,
            phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
            tests: {},
          },
        }),
      selectIncrementalRunWork: () =>
        Promise.resolve({
          parsedFiles: [
            {
              filePath: 'tests/tools/sample.test.ts',
              tests: [{ name: 'sample', fullPath: 'sample', source: '', startLine: 1, endLine: 1 }],
            },
          ],
          previousConsolidatedManifest: null,
          selection: {
            phase1SelectedTestKeys: ['tests/tools/sample.test.ts::sample'],
            phase2aSelectedTestKeys: ['tests/tools/sample.test.ts::sample'],
            phase2bSelectedFeatureKeys: [],
            phase3SelectedConsolidatedIds: [],
            reportRebuildOnly: false,
          },
        }),
      loadOrCreateProgress: () =>
        Promise.resolve({
          version: 4,
          startedAt: '2026-04-22T12:00:00.000Z',
          phase1: {
            status: 'not-started',
            completedTests: {},
            failedTests: {},
            completedFiles: [],
            stats: { filesTotal: 1, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
          },
          phase2a: {
            status: 'not-started',
            completedBehaviors: {},
            failedBehaviors: {},
            stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
          },
          phase2b: {
            status: 'not-started',
            completedFeatureKeys: {},
            failedFeatureKeys: {},
            stats: {
              featureKeysTotal: 0,
              featureKeysDone: 0,
              featureKeysFailed: 0,
              behaviorsConsolidated: 0,
            },
          },
          phase3: {
            status: 'not-started',
            completedConsolidatedIds: {},
            failedConsolidatedIds: {},
            stats: { consolidatedIdsTotal: 0, consolidatedIdsDone: 0, consolidatedIdsFailed: 0 },
          },
        }),
      rebuildReportsFromStoredResults: () => Promise.resolve(),
      runPhase1IfNeeded: () => Promise.resolve(),
      runPhase2aIfNeeded: (_progress, _manifest, selectedTestKeys) => {
        calls.push({ phase2a: [...selectedTestKeys].toSorted(), phase2b: [] })
        return Promise.resolve(new Set(['task-creation']))
      },
      runPhase2bIfNeeded: (_progress, _phaseVersion, selectedFeatureKeys) => {
        const last = calls[calls.length - 1]
        if (last === undefined) {
          throw new Error('Expected phase2a call before phase2b')
        }
        calls[calls.length - 1] = {
          phase2a: last.phase2a,
          phase2b: [...selectedFeatureKeys].toSorted(),
        }
        return Promise.resolve({ version: 1, entries: {} })
      },
      saveConsolidatedManifest: () => Promise.resolve(),
      runPhase3IfNeeded: () => Promise.resolve(),
      log: { log: mock(() => {}) },
    }

    await runBehaviorAudit(deps)

    expect(calls).toEqual([
      {
        phase2a: ['tests/tools/sample.test.ts::sample'],
        phase2b: ['task-creation'],
      },
    ])
  })
})
