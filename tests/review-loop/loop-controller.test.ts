import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ChangeCapture } from '../../scripts/review-loop/change-capture.js'
import type { ReviewLoopConfig } from '../../scripts/review-loop/config.js'
import { createIssueLedger, HumanReviewFileSchema, type IssueLedger } from '../../scripts/review-loop/issue-ledger.js'
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

interface StubCaptureOptions {
  files?: string[]
  diff?: string
}

const makeStubChangeCapture = (options: StubCaptureOptions = {}): ChangeCapture => ({
  captureBaseline: (): Promise<string> => Promise.resolve('baseline-sha'),
  describeChangesSinceBaseline: (): Promise<{ files: string[]; diff: string }> =>
    Promise.resolve({ files: options.files ?? ['src/message-queue/queue.ts'], diff: options.diff ?? '-old\n+new' }),
})

const fixDescriptionReply = (whatChanged: string, whyChanged: string): string =>
  JSON.stringify({ whatChanged, whyChanged })

describe('runReviewLoop', () => {
  test('runs until the reviewer reports no issues and records fix changes', async () => {
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
      fixDescriptionReply('Moved the lock acquisition earlier.', 'Prevents concurrent queue flush races.'),
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
      changeCapture: makeStubChangeCapture(),
    })

    expect(result.doneReason).toBe('clean')
    expect(result.rounds).toBe(1)
    const records = Object.values(result.ledger.issues)
    expect(records.every((record) => record.status === 'closed')).toBe(true)
    expect(records).toHaveLength(1)
    const [record] = records
    expect(record?.fixChanges).toHaveLength(1)
    expect(record?.fixChanges[0]?.files).toEqual(['src/message-queue/queue.ts'])
    expect(record?.fixChanges[0]?.whatChanged).toBe('Moved the lock acquisition earlier.')
    expect(record?.fixChanges[0]?.whyChanged).toBe('Prevents concurrent queue flush races.')
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
          if (fixerPrompts.length === 1) {
            return Promise.resolve({
              text: JSON.stringify({
                verdict: 'valid',
                fixability: 'auto',
                reasoning: 'The control flow is actually unsafe.',
                targetFiles: ['src/message-queue/queue.ts'],
                fixPlan: 'Take the lock before the flush branch.',
              }),
              stopReason: 'end_turn',
            })
          }
          if (fixerPrompts.length === 2) {
            return Promise.resolve({
              text: 'Applied the minimal fix and ran the targeted test.',
              stopReason: 'end_turn',
            })
          }
          return Promise.resolve({
            text: fixDescriptionReply('Moved lock earlier.', 'Prevents the race.'),
            stopReason: 'end_turn',
          })
        },
      },
      changeCapture: makeStubChangeCapture(),
    })

    expect(reviewerPrompts).toHaveLength(2)
    expect(fixerPrompts).toHaveLength(3)
    expect(reviewerPrompts[0]?.startsWith('/review-code ')).toBe(true)
    expect(reviewerPrompts[1]?.startsWith('/review-code ')).toBe(true)
    expect(fixerPrompts[0]?.startsWith('/verify-issue ')).toBe(true)
    expect(fixerPrompts[1]?.startsWith('/fix-issue ')).toBe(true)
    expect(fixerPrompts[2]?.startsWith('/fix-issue ')).toBe(true)
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
      changeCapture: makeStubChangeCapture(),
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
      changeCapture: makeStubChangeCapture(),
    })

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
      changeCapture: makeStubChangeCapture(),
    })

    expect(result.doneReason).toBe('max_rounds')
    expect(result.rounds).toBe(1)
    expect(Object.values(result.ledger.issues).every((record) => record.status === 'rejected')).toBe(true)
  })

  test('marks an issue as needs_human when a prior fix change contradicts it', async () => {
    const repoRoot = makeTempDir()
    const config: ReviewLoopConfig = {
      repoRoot,
      workDir: path.join(repoRoot, '.review-loop'),
      maxRounds: 2,
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
    const ledger: IssueLedger = await createIssueLedger(runState.runDir)

    const firstIssue = {
      title: 'Remove debug logging',
      severity: 'high' as const,
      summary: 'Debug logs leak sensitive data.',
      whyItMatters: 'Secrets are printed on stderr.',
      evidence: 'src/foo.ts lines 10-20',
      file: 'src/foo.ts',
      lineStart: 10,
      lineEnd: 20,
      suggestedFix: 'Remove the debug log statements.',
      confidence: 0.9,
    }
    const secondIssue = {
      title: 'Add more debug logging',
      severity: 'high' as const,
      summary: 'Missing observability around request flow.',
      whyItMatters: 'Hard to diagnose production issues.',
      evidence: 'src/foo.ts lines 10-20',
      file: 'src/foo.ts',
      lineStart: 10,
      lineEnd: 20,
      suggestedFix: 'Add debug logs for every branch.',
      confidence: 0.9,
    }

    const reviewerReplies = [
      JSON.stringify({ round: 1, issues: [firstIssue, secondIssue] }),
      JSON.stringify({ round: 2, issues: [] }),
    ]
    const fixerReplies = [
      // issue 1: verify (no prior changes, no contradiction check)
      JSON.stringify({
        verdict: 'valid',
        fixability: 'auto',
        reasoning: 'Debug logs can leak secrets.',
        targetFiles: ['src/foo.ts'],
        fixPlan: 'Delete the debug log lines.',
      }),
      // issue 1: fix
      'Removed debug log lines.',
      // issue 1: describe fix
      fixDescriptionReply('Deleted four debug log statements in src/foo.ts.', 'Prevents leaking secrets to stderr.'),
      // issue 2: contradiction check (prior change exists) -> contradicts
      JSON.stringify({
        contradicts: true,
        reasoning: 'A prior fix in this run just removed debug logging from the same file for security reasons.',
        conflictingChangeIndices: [0],
      }),
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
        availableCommands: ['verify-issue', 'fix-issue'],
        promptText: () =>
          Promise.resolve({
            text: fixerReplies[fixerIndex++] ?? 'done',
            stopReason: 'end_turn',
          }),
      },
      changeCapture: makeStubChangeCapture({ files: ['src/foo.ts'] }),
    })

    expect(result.doneReason).toBe('clean')
    const records = Object.values(result.ledger.issues)
    const closed = records.find((r) => r.issue.title === 'Remove debug logging')
    const needsHuman = records.find((r) => r.issue.title === 'Add more debug logging')
    expect(closed?.status).toBe('closed')
    expect(needsHuman?.status).toBe('needs_human')

    const persistedHumanReview = HumanReviewFileSchema.parse(JSON.parse(readFileSync(ledger.humanReviewPath, 'utf8')))
    expect(persistedHumanReview.entries).toHaveLength(1)
    expect(persistedHumanReview.entries[0]?.issue.title).toBe('Add more debug logging')
    expect(persistedHumanReview.entries[0]?.contradictionCheck.contradicts).toBe(true)
  })
})
