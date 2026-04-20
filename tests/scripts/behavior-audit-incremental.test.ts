import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type * as IncrementalModule from '../../scripts/behavior-audit/incremental.js'

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

async function loadIncrementalModule(): Promise<typeof IncrementalModule> {
  const mod: unknown = await import(`../../scripts/behavior-audit/incremental.js?test=${crypto.randomUUID()}`)
  if (!isIncrementalModule(mod)) throw new Error('Unexpected incremental module shape')
  return mod
}

async function loadBehaviorAuditEntryPoint(tag: string): Promise<void> {
  await import(`../../scripts/behavior-audit.ts?test=${tag}`)
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

    void mock.module('../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
      CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
      STORIES_DIR: path.join(reportsDir, 'stories'),
      PROGRESS_PATH: path.join(reportsDir, 'progress.json'),
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
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
    void mock.module('../../scripts/behavior-audit/evaluate.js', () => ({
      runPhase3: async (): Promise<void> => {},
    }))
    void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
      runPhase2: (): Promise<IncrementalModule.ConsolidatedManifest> => Promise.resolve({ version: 1, entries: {} }),
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
          'tests/tools/create-task.test.ts::suite > case': {
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedBehaviorPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          },
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
      previousConsolidatedManifest: null,
    })

    expect(selection.phase1SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
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
          'tests/tools/create-task.test.ts::suite > case': {
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedBehaviorPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          },
          'tests/tools/no-behavior.test.ts::suite > pending': {
            testFile: 'tests/tools/no-behavior.test.ts',
            testName: 'suite > pending',
            dependencyPaths: ['tests/tools/no-behavior.test.ts'],
            phase1Fingerprint: 'fp3',
            phase2Fingerprint: null,
            extractedBehaviorPath: null,
            domain: 'tools',
            lastPhase1CompletedAt: null,
            lastPhase2CompletedAt: null,
          },
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
    expect(selection.phase2SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
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
          'tests/tools/create-task.test.ts::suite > case': {
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedBehaviorPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          },
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1-new' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
      previousConsolidatedManifest: null,
    })

    expect(selection.phase1SelectedTestKeys).toEqual([])
    expect(selection.phase2SelectedTestKeys).toEqual([])
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
    expect(selection.phase2SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > new case'])
    expect(selection.phase3SelectedConsolidatedIds).toEqual([])
    expect(selection.reportRebuildOnly).toBe(false)
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
})
