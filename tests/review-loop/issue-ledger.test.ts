import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'

import {
  createIssueLedger,
  applyReviewRound,
  recordVerification,
  recordFixAttempt,
  saveIssueLedger,
} from '../../scripts/review-loop/issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from '../../scripts/review-loop/issue-schema.js'

const tempDirs: string[] = []

const issue: ReviewerIssue = {
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
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('issue ledger', () => {
  test('reopens closed issues when the reviewer reports them again', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const record = applyReviewRound(ledger, 1, [issue])[0]
    if (record === undefined) {
      throw new Error('Expected a ledger record')
    }

    const decision: VerifierDecision = {
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'The control flow is actually unsafe.',
      targetFiles: ['src/message-queue/queue.ts'],
      fixPlan: 'Take the lock before the flush branch.',
    }

    recordVerification(ledger, record.fingerprint, decision)
    recordFixAttempt(ledger, record.fingerprint)
    ledger.snapshot.issues[record.fingerprint]!.status = 'closed'
    applyReviewRound(ledger, 2, [issue])
    await saveIssueLedger(ledger)

    const PersistedSchema = z.object({
      issues: z.record(z.string(), z.object({ status: z.string(), fixAttempts: z.number() })),
    })
    const persisted = PersistedSchema.parse(JSON.parse(readFileSync(ledger.path, 'utf8')))

    expect(persisted.issues[record.fingerprint]?.status).toBe('reopened')
    expect(persisted.issues[record.fingerprint]?.fixAttempts).toBe(1)
  })
})
