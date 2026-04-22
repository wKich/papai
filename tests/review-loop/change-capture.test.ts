import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { DEFAULT_MAX_DIFF_BYTES, createGitChangeCapture } from '../../scripts/review-loop/change-capture.js'

const tempDirs: string[] = []

const isolatedGitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

async function run(cwd: string, args: readonly string[]): Promise<void> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: isolatedGitEnv,
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`)
  }
}

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-capture-'))
  tempDirs.push(dir)
  await run(dir, ['init', '-q', '-b', 'main'])
  await run(dir, ['config', 'user.email', 'test@example.com'])
  await run(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'seed.txt'), 'seed\n')
  await run(dir, ['add', 'seed.txt'])
  await run(dir, ['commit', '-q', '-m', 'seed'])
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('git change capture', () => {
  test('describes tracked file changes and untracked additions since the baseline', async () => {
    const repo = await makeRepo()
    const capture = createGitChangeCapture(repo, { maxDiffBytes: DEFAULT_MAX_DIFF_BYTES, env: isolatedGitEnv })
    const baseline = await capture.captureBaseline()

    writeFileSync(path.join(repo, 'seed.txt'), 'seed\nmore\n')
    writeFileSync(path.join(repo, 'new.txt'), 'hello\n')

    const delta = await capture.describeChangesSinceBaseline(baseline)
    expect(delta.files).toContain('seed.txt')
    expect(delta.files).toContain('new.txt')
    expect(delta.diff).toContain('+more')
  })

  test('returns an empty diff when nothing changed after baseline capture', async () => {
    const repo = await makeRepo()
    const capture = createGitChangeCapture(repo, { maxDiffBytes: DEFAULT_MAX_DIFF_BYTES, env: isolatedGitEnv })
    const baseline = await capture.captureBaseline()

    const delta = await capture.describeChangesSinceBaseline(baseline)
    expect(delta.files).toEqual([])
    expect(delta.diff).toBe('')
  })
})
