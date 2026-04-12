import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import type { ReviewLoopConfig } from '../../scripts/review-loop/config.js'
import { createRunState, loadRunState, saveRunState } from '../../scripts/review-loop/run-state.js'

const tempDirs: string[] = []
const SessionPointerSchema = z.object({
  sessionId: z.string().nullable(),
})

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

test('run state persists session ids through pointer files', async () => {
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

  const state = await createRunState(
    config,
    path.join(repoRoot, 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md'),
  )
  const persisted = z.object({ planPath: z.string() }).parse(JSON.parse(readFileSync(state.statePath, 'utf8')))
  const reviewerSessionPointer = SessionPointerSchema.parse(JSON.parse(readFileSync(state.reviewerSessionPath, 'utf8')))
  const fixerSessionPointer = SessionPointerSchema.parse(JSON.parse(readFileSync(state.fixerSessionPath, 'utf8')))

  expect(state.runDir.startsWith(path.join(config.workDir, 'runs'))).toBe(true)
  expect(persisted.planPath).toBe(
    path.join(repoRoot, 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md'),
  )
  expect(reviewerSessionPointer.sessionId).toBeNull()
  expect(fixerSessionPointer.sessionId).toBeNull()
  expect(existsSync(state.reviewerSessionPath)).toBe(true)
  expect(existsSync(state.fixerSessionPath)).toBe(true)

  state.reviewerSessionId = 'reviewer-session-123'
  state.fixerSessionId = 'fixer-session-456'
  await saveRunState(state)

  const reloaded = await loadRunState(config.workDir, state.runId)
  const savedReviewerSessionPointer = SessionPointerSchema.parse(
    JSON.parse(readFileSync(state.reviewerSessionPath, 'utf8')),
  )
  const savedFixerSessionPointer = SessionPointerSchema.parse(JSON.parse(readFileSync(state.fixerSessionPath, 'utf8')))

  expect(reloaded.planPath).toBe(state.planPath)
  expect(reloaded.reviewerSessionId).toBe('reviewer-session-123')
  expect(reloaded.fixerSessionId).toBe('fixer-session-456')
  expect(savedReviewerSessionPointer.sessionId).toBe('reviewer-session-123')
  expect(savedFixerSessionPointer.sessionId).toBe('fixer-session-456')
})
