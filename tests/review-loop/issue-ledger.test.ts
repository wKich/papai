import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createIssueLedger,
  applyReviewRound,
  IssueLedgerSnapshotSchema,
  listAllFixChanges,
  loadIssueLedger,
  markNeedsHumanForContradiction,
  recordFixAttempt,
  recordFixChange,
  recordVerification,
  saveHumanReview,
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
  test('deduplicates repeated issues within the same review round', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const duplicateIssues = [issue, { ...issue }]

    const records = applyReviewRound(ledger, 1, duplicateIssues)

    expect(records).toHaveLength(1)
    expect(records[0]?.fingerprint).toBeDefined()
    expect(Object.keys(ledger.snapshot.issues)).toHaveLength(1)
  })

  test('distinguishes invalid and already_fixed verification statuses', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const [invalidRecord, alreadyFixedRecord] = applyReviewRound(ledger, 1, [
      issue,
      {
        ...issue,
        title: 'Queue flush race is already fixed',
        summary: 'The lock now protects the flush path.',
      },
    ])

    if (invalidRecord === undefined || alreadyFixedRecord === undefined) {
      throw new Error('Expected two ledger records')
    }

    recordVerification(ledger, invalidRecord.fingerprint, {
      verdict: 'invalid',
      fixability: 'manual',
      reasoning: 'The bug report is not supported by the current code.',
      targetFiles: ['src/message-queue/queue.ts'],
      fixPlan: 'No fix needed.',
    })
    recordVerification(ledger, alreadyFixedRecord.fingerprint, {
      verdict: 'already_fixed',
      fixability: 'manual',
      reasoning: 'The implementation already contains the described fix.',
      targetFiles: ['src/message-queue/queue.ts'],
      fixPlan: 'No fix needed.',
    })

    await saveIssueLedger(ledger)
    const loaded = await loadIssueLedger(runDir)

    expect(loaded.snapshot.issues[invalidRecord.fingerprint]?.status).toBe('rejected')
    expect(loaded.snapshot.issues[alreadyFixedRecord.fingerprint]?.status).toBe('already_fixed')
    expect(loaded.snapshot.issues[invalidRecord.fingerprint]?.verifierDecision?.verdict).toBe('invalid')
    expect(loaded.snapshot.issues[alreadyFixedRecord.fingerprint]?.verifierDecision?.verdict).toBe('already_fixed')
  })

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
    const persisted = await loadIssueLedger(runDir)

    expect(persisted.snapshot.issues[record.fingerprint]?.status).toBe('reopened')
    expect(persisted.snapshot.issues[record.fingerprint]?.fixAttempts).toBe(1)
  })

  test('reopens fixed pending review issues when the reviewer reports them again', async () => {
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
    applyReviewRound(ledger, 2, [issue])
    await saveIssueLedger(ledger)

    const persisted = IssueLedgerSnapshotSchema.parse(JSON.parse(readFileSync(ledger.path, 'utf8')))

    expect(persisted.issues[record.fingerprint]?.status).toBe('reopened')
    expect(persisted.issues[record.fingerprint]?.fixAttempts).toBe(1)
  })

  test('records fix changes and lists them across issues', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const record = applyReviewRound(ledger, 1, [issue])[0]
    if (record === undefined) {
      throw new Error('Expected a ledger record')
    }

    recordFixChange(ledger, record.fingerprint, {
      round: 1,
      timestamp: '2026-04-22T00:00:00.000Z',
      files: ['src/message-queue/queue.ts'],
      whatChanged: 'Moved the lock acquisition earlier in the flush path.',
      whyChanged: 'Prevents the identified race condition.',
    })
    await saveIssueLedger(ledger)

    const reloaded = await loadIssueLedger(runDir)
    expect(reloaded.snapshot.issues[record.fingerprint]?.fixChanges).toHaveLength(1)
    const all = listAllFixChanges(reloaded)
    expect(all).toHaveLength(1)
    expect(all[0]?.issueTitle).toBe(issue.title)
    expect(all[0]?.change.files).toEqual(['src/message-queue/queue.ts'])
  })

  test('persists human-review entries for contradictory issues', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const record = applyReviewRound(ledger, 2, [issue])[0]
    if (record === undefined) {
      throw new Error('Expected a ledger record')
    }

    const entry = markNeedsHumanForContradiction(
      ledger,
      record.fingerprint,
      2,
      {
        contradicts: true,
        reasoning: 'Prior fix already removed this code path.',
        conflictingChangeIndices: [0],
      },
      [
        {
          fingerprint: 'other',
          issueTitle: 'Previously closed issue',
          change: {
            round: 1,
            timestamp: '2026-04-22T00:00:00.000Z',
            files: ['src/foo.ts'],
            whatChanged: 'Removed the code path.',
            whyChanged: 'It was unreachable.',
          },
        },
      ],
    )
    await saveHumanReview(ledger)
    await saveIssueLedger(ledger)

    expect(ledger.snapshot.issues[record.fingerprint]?.status).toBe('needs_human')
    expect(entry.contradictionCheck.contradicts).toBe(true)

    const reloaded = await loadIssueLedger(runDir)
    expect(reloaded.humanReview.entries).toHaveLength(1)
    expect(reloaded.humanReview.entries[0]?.conflictingChanges).toHaveLength(1)
  })
})
