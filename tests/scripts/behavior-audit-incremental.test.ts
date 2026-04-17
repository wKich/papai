import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('behavior-audit incremental manifest', () => {
  let reportsDir: string
  let manifestPath: string

  beforeEach(() => {
    const root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')

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
})
