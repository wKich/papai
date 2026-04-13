import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ReviewLoopConfig } from '../../scripts/review-loop/config.js'
import { createIssueLedger } from '../../scripts/review-loop/issue-ledger.js'
import { runReviewLoop } from '../../scripts/review-loop/loop-controller.js'
import { createRunState } from '../../scripts/review-loop/run-state.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-controller-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('runReviewLoop', () => {
  test('runs until the reviewer reports no issues', async () => {
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

    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    const reviewerReplies = [
      JSON.stringify({
        round: 1,
        issues: [
          {
            title: 'Race condition in queue flush path',
            severity: 'high',
            summary: 'Two concurrent messages can bypass the intended lock.',
            whyItMatters: 'This can produce stale assistant replies.',
            evidence: 'src/message-queue/queue.ts lines 84-107',
            file: 'src/message-queue/queue.ts',
            lineStart: 84,
            lineEnd: 107,
            suggestedFix: 'Take the processing lock earlier.',
            confidence: 0.92,
          },
        ],
      }),
      JSON.stringify({ round: 2, issues: [] }),
    ]

    const fixerReplies = [
      JSON.stringify({
        verdict: 'valid',
        fixability: 'auto',
        reasoning: 'The control flow is actually unsafe.',
        targetFiles: ['src/message-queue/queue.ts'],
        fixPlan: 'Take the lock before the flush branch.',
      }),
      'Applied the minimal fix and ran the targeted test.',
    ]

    let reviewerIndex = 0
    let fixerIndex = 0

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: ['review-code'],
        promptText: () =>
          Promise.resolve({
            text: reviewerReplies[reviewerIndex++] ?? JSON.stringify({ round: 999, issues: [] }),
            stopReason: 'end_turn',
          }),
      },
      fixer: {
        availableCommands: ['verify-issue'],
        promptText: () =>
          Promise.resolve({
            text: fixerReplies[fixerIndex++] ?? 'done',
            stopReason: 'end_turn',
          }),
      },
    })

    expect(result.doneReason).toBe('clean')
    expect(result.rounds).toBe(1)
    expect(Object.values(result.ledger.issues).every((record) => record.status === 'closed')).toBe(true)
  })
})
