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

  test('uses configured invocation prefixes for review, verify, fix, and rereview prompts', async () => {
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
        requireInvocationPrefix: true,
      },
      fixer: {
        command: 'opencode',
        args: ['acp'],
        env: {},
        sessionConfig: {},
        verifyInvocationPrefix: '/verify-issue',
        fixInvocationPrefix: '/fix-issue',
        requireVerifyInvocation: true,
      },
    }

    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    const reviewerPrompts: string[] = []
    const fixerPrompts: string[] = []

    await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: ['review-code'],
        promptText: (text) => {
          reviewerPrompts.push(text)
          return Promise.resolve({
            text:
              reviewerPrompts.length === 1
                ? JSON.stringify({
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
                  })
                : JSON.stringify({ round: 2, issues: [] }),
            stopReason: 'end_turn',
          })
        },
      },
      fixer: {
        availableCommands: ['verify-issue', 'fix-issue'],
        promptText: (text) => {
          fixerPrompts.push(text)
          return Promise.resolve({
            text:
              fixerPrompts.length === 1
                ? JSON.stringify({
                    verdict: 'valid',
                    fixability: 'auto',
                    reasoning: 'The control flow is actually unsafe.',
                    targetFiles: ['src/message-queue/queue.ts'],
                    fixPlan: 'Take the lock before the flush branch.',
                  })
                : 'Applied the minimal fix and ran the targeted test.',
            stopReason: 'end_turn',
          })
        },
      },
    })

    expect(reviewerPrompts).toHaveLength(2)
    expect(fixerPrompts).toHaveLength(2)
    expect(reviewerPrompts[0]?.startsWith('/review-code ')).toBe(true)
    expect(reviewerPrompts[1]?.startsWith('/review-code ')).toBe(true)
    expect(fixerPrompts[0]?.startsWith('/verify-issue ')).toBe(true)
    expect(fixerPrompts[1]?.startsWith('/fix-issue ')).toBe(true)
  })

  test('stops with no_progress when a round produces no auto-fixable progress', async () => {
    const repoRoot = makeTempDir()
    const config: ReviewLoopConfig = {
      repoRoot,
      workDir: path.join(repoRoot, '.review-loop'),
      maxRounds: 5,
      maxNoProgressRounds: 1,
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
        fixInvocationPrefix: '/fix-issue',
        requireVerifyInvocation: false,
      },
    }

    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    let reviewerPromptCount = 0

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: ['review-code'],
        promptText: () => {
          reviewerPromptCount += 1
          return Promise.resolve({
            text: JSON.stringify({
              round: reviewerPromptCount,
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
            stopReason: 'end_turn',
          })
        },
      },
      fixer: {
        availableCommands: ['verify-issue', 'fix-issue'],
        promptText: () =>
          Promise.resolve({
            text: JSON.stringify({
              verdict: 'needs_human',
              fixability: 'manual',
              reasoning: 'This needs a product decision.',
              targetFiles: ['src/message-queue/queue.ts'],
              fixPlan: 'Escalate to a human reviewer.',
            }),
            stopReason: 'end_turn',
          }),
      },
    })

    expect(result.doneReason).toBe('no_progress')
    expect(result.rounds).toBe(1)
    expect(Object.values(result.ledger.issues).every((record) => record.status === 'needs_human')).toBe(true)
  })

  test('does not re-verify issues already in a terminal status across rounds', async () => {
    const repoRoot = makeTempDir()
    const config: ReviewLoopConfig = {
      repoRoot,
      workDir: path.join(repoRoot, '.review-loop'),
      maxRounds: 5,
      // allow two no-progress rounds so we reach round 2
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
    let verifyCallCount = 0

    // Reviewer always re-raises the same issue every round (and re-review)
    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: ['review-code'],
        promptText: () =>
          Promise.resolve({
            text: JSON.stringify({
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
            stopReason: 'end_turn',
          }),
      },
      fixer: {
        availableCommands: ['verify-issue'],
        promptText: () => {
          verifyCallCount += 1
          return Promise.resolve({
            text: JSON.stringify({
              verdict: 'invalid',
              fixability: 'manual',
              reasoning: 'False positive — the lock is already taken upstream.',
              targetFiles: ['src/message-queue/queue.ts'],
              fixPlan: 'Do nothing.',
            }),
            stopReason: 'end_turn',
          })
        },
      },
    })

    // The issue was rejected in round 1. The reviewer raises it again in round 2,
    // but the verifier must NOT be called again for an already-rejected issue.
    expect(verifyCallCount).toBe(1)
    expect(result.doneReason).toBe('no_progress')
    expect(Object.values(result.ledger.issues).every((record) => record.status === 'rejected')).toBe(true)
  })

  test('stops with max_rounds when unresolved issues remain after the final round', async () => {
    const repoRoot = makeTempDir()
    const config: ReviewLoopConfig = {
      repoRoot,
      workDir: path.join(repoRoot, '.review-loop'),
      maxRounds: 1,
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
        fixInvocationPrefix: '/fix-issue',
        requireVerifyInvocation: false,
      },
    }

    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    let reviewerPromptCount = 0

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: ['review-code'],
        promptText: () => {
          reviewerPromptCount += 1
          return Promise.resolve({
            text: JSON.stringify({
              round: reviewerPromptCount,
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
            stopReason: 'end_turn',
          })
        },
      },
      fixer: {
        availableCommands: ['verify-issue', 'fix-issue'],
        promptText: () =>
          Promise.resolve({
            text: JSON.stringify({
              verdict: 'invalid',
              fixability: 'manual',
              reasoning: 'This is a false positive.',
              targetFiles: ['src/message-queue/queue.ts'],
              fixPlan: 'Do not change the code.',
            }),
            stopReason: 'end_turn',
          }),
      },
    })

    expect(result.doneReason).toBe('max_rounds')
    expect(result.rounds).toBe(1)
    expect(Object.values(result.ledger.issues).every((record) => record.status === 'rejected')).toBe(true)
  })
})
