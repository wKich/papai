import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    typeof value['saveManifest'] === 'function'
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
      'commit',
      '--allow-empty',
      '-m',
      'init',
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
      STORIES_DIR: path.join(reportsDir, 'stories'),
      PROGRESS_PATH: path.join(reportsDir, 'progress.json'),
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
    void mock.module('../../scripts/behavior-audit/extract.js', () => ({
      runPhase1: async (): Promise<void> => {
        phase1Calls += 1
        phase1ManifestSnapshot = await Bun.file(manifestPath).text()
      },
    }))
    void mock.module('../../scripts/behavior-audit/evaluate.js', () => ({
      runPhase2: async (): Promise<void> => {},
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
})
