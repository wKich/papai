import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'

import { createRunState } from '../../scripts/review-loop/run-state.js'
import type { ReviewLoopConfig } from '../../scripts/review-loop/config.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-state-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createRunState creates the run directory, state file, and session pointer files', async () => {
  const repoRoot = makeTempDir()
  const config: ReviewLoopConfig = {
    repoRoot,
    workDir: path.join(repoRoot, '.review-loop'),
    maxRounds: 5,
    maxNoProgressRounds: 2,
    reviewer: {
      command: '/usr/local/bin/claude-acp-adapter',
      args: [],
      env: {},
      sessionConfig: {},
      invocationPrefix: '/review-code',
      requireInvocationPrefix: false,
    },
    fixer: {
      command: 'opencode',
      args: ['acp'],
      env: {},
      sessionConfig: {},
      verifyInvocationPrefix: '/verify-issue',
      fixInvocationPrefix: null,
      requireVerifyInvocation: false,
    },
  }

  const state = await createRunState(config, path.join(repoRoot, 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md'))
  const persisted = z.object({ planPath: z.string() }).parse(JSON.parse(readFileSync(state.statePath, 'utf8')))

  expect(state.runDir.startsWith(path.join(config.workDir, 'runs'))).toBe(true)
  expect(persisted.planPath).toBe(path.join(repoRoot, 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md'))
  expect(existsSync(state.reviewerSessionPath)).toBe(true)
  expect(existsSync(state.fixerSessionPath)).toBe(true)
})
