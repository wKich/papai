import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { computeIssueFingerprint } from './issue-fingerprint.js'
import { ContradictionCheckSchema, ReviewerIssueSchema, VerifierDecisionSchema } from './issue-schema.js'
import type { ContradictionCheck, ReviewerIssue, VerifierDecision } from './issue-schema.js'

export type LedgerIssueStatus =
  | 'discovered'
  | 'verified'
  | 'rejected'
  | 'already_fixed'
  | 'needs_human'
  | 'fixed_pending_review'
  | 'closed'
  | 'reopened'

export const FixChangeRecordSchema = z.object({
  round: z.number().int().nonnegative(),
  timestamp: z.string(),
  files: z.array(z.string()),
  whatChanged: z.string(),
  whyChanged: z.string(),
})

export const LedgerIssueRecordSchema = z.object({
  fingerprint: z.string(),
  issue: ReviewerIssueSchema,
  status: z.enum([
    'discovered',
    'verified',
    'rejected',
    'already_fixed',
    'needs_human',
    'fixed_pending_review',
    'closed',
    'reopened',
  ]),
  firstSeenRound: z.number().int().nonnegative(),
  latestSeenRound: z.number().int().nonnegative(),
  fixAttempts: z.number().int().nonnegative(),
  verifierDecision: VerifierDecisionSchema.nullable(),
  fixChanges: z.array(FixChangeRecordSchema).default([]),
})

export const IssueLedgerSnapshotSchema = z.object({
  issues: z.record(z.string(), LedgerIssueRecordSchema),
})

export const HumanReviewEntrySchema = z.object({
  fingerprint: z.string(),
  round: z.number().int().nonnegative(),
  timestamp: z.string(),
  issue: ReviewerIssueSchema,
  contradictionCheck: ContradictionCheckSchema,
  conflictingChanges: z.array(
    z.object({
      fingerprint: z.string(),
      issueTitle: z.string(),
      change: FixChangeRecordSchema,
    }),
  ),
})

export const HumanReviewFileSchema = z.object({
  entries: z.array(HumanReviewEntrySchema),
})

export interface FixChangeRecord {
  round: number
  timestamp: string
  files: string[]
  whatChanged: string
  whyChanged: string
}

export interface LedgerIssueRecord {
  fingerprint: string
  issue: ReviewerIssue
  status: LedgerIssueStatus
  firstSeenRound: number
  latestSeenRound: number
  fixAttempts: number
  verifierDecision: VerifierDecision | null
  fixChanges: FixChangeRecord[]
}

export interface IssueLedgerSnapshot {
  issues: Record<string, LedgerIssueRecord>
}

export interface HumanReviewEntry {
  fingerprint: string
  round: number
  timestamp: string
  issue: ReviewerIssue
  contradictionCheck: ContradictionCheck
  conflictingChanges: Array<{
    fingerprint: string
    issueTitle: string
    change: FixChangeRecord
  }>
}

export interface HumanReviewFile {
  entries: HumanReviewEntry[]
}

export interface IssueLedger {
  path: string
  humanReviewPath: string
  snapshot: IssueLedgerSnapshot
  humanReview: HumanReviewFile
}

export async function createIssueLedger(runDir: string): Promise<IssueLedger> {
  const ledger: IssueLedger = {
    path: path.join(runDir, 'ledger.json'),
    humanReviewPath: path.join(runDir, 'human-review.json'),
    snapshot: { issues: {} },
    humanReview: { entries: [] },
  }
  await saveIssueLedger(ledger)
  await saveHumanReview(ledger)
  return ledger
}

export async function loadIssueLedger(runDir: string): Promise<IssueLedger> {
  const ledgerPath = path.join(runDir, 'ledger.json')
  const humanReviewPath = path.join(runDir, 'human-review.json')
  const snapshot = IssueLedgerSnapshotSchema.parse(JSON.parse(await readFile(ledgerPath, 'utf8')))
  const humanReview = await loadHumanReviewFile(humanReviewPath)
  return {
    path: ledgerPath,
    humanReviewPath,
    snapshot,
    humanReview,
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT'
  )
}

async function loadHumanReviewFile(humanReviewPath: string): Promise<HumanReviewFile> {
  try {
    return HumanReviewFileSchema.parse(JSON.parse(await readFile(humanReviewPath, 'utf8')))
  } catch (error) {
    if (isNotFoundError(error)) {
      return { entries: [] }
    }
    throw error
  }
}

export function applyReviewRound(
  ledger: IssueLedger,
  round: number,
  issues: readonly ReviewerIssue[],
): readonly LedgerIssueRecord[] {
  const seenFingerprints = new Set<string>()
  const roundRecords: LedgerIssueRecord[] = []

  for (const issue of issues) {
    const fingerprint = computeIssueFingerprint(issue)
    if (seenFingerprints.has(fingerprint)) {
      continue
    }
    seenFingerprints.add(fingerprint)

    const existing = ledger.snapshot.issues[fingerprint]

    const next: LedgerIssueRecord =
      existing === undefined
        ? {
            fingerprint,
            issue,
            status: 'discovered',
            firstSeenRound: round,
            latestSeenRound: round,
            fixAttempts: 0,
            verifierDecision: null,
            fixChanges: [],
          }
        : {
            ...existing,
            issue,
            latestSeenRound: round,
            status:
              existing.status === 'closed' || existing.status === 'fixed_pending_review' ? 'reopened' : existing.status,
          }

    ledger.snapshot.issues[fingerprint] = next
    roundRecords.push(next)
  }

  return roundRecords
}

export function recordVerification(ledger: IssueLedger, fingerprint: string, decision: VerifierDecision): void {
  const record = ledger.snapshot.issues[fingerprint]
  if (record === undefined) {
    throw new Error(`Unknown issue fingerprint ${fingerprint}`)
  }

  record.verifierDecision = decision
  record.status = mapVerifierDecisionToLedgerStatus(decision.verdict)
}

export function recordFixAttempt(ledger: IssueLedger, fingerprint: string): void {
  const record = ledger.snapshot.issues[fingerprint]
  if (record === undefined) {
    throw new Error(`Unknown issue fingerprint ${fingerprint}`)
  }

  record.fixAttempts += 1
  record.status = 'fixed_pending_review'
}

export function recordFixChange(ledger: IssueLedger, fingerprint: string, change: FixChangeRecord): void {
  const record = ledger.snapshot.issues[fingerprint]
  if (record === undefined) {
    throw new Error(`Unknown issue fingerprint ${fingerprint}`)
  }
  record.fixChanges.push(change)
}

export function listAllFixChanges(
  ledger: IssueLedger,
): Array<{ fingerprint: string; issueTitle: string; change: FixChangeRecord }> {
  const entries: Array<{ fingerprint: string; issueTitle: string; change: FixChangeRecord }> = []
  for (const record of Object.values(ledger.snapshot.issues)) {
    for (const change of record.fixChanges) {
      entries.push({ fingerprint: record.fingerprint, issueTitle: record.issue.title, change })
    }
  }
  return entries
}

export function markNeedsHumanForContradiction(
  ledger: IssueLedger,
  fingerprint: string,
  round: number,
  contradictionCheck: ContradictionCheck,
  conflictingChanges: HumanReviewEntry['conflictingChanges'],
): HumanReviewEntry {
  const record = ledger.snapshot.issues[fingerprint]
  if (record === undefined) {
    throw new Error(`Unknown issue fingerprint ${fingerprint}`)
  }

  record.status = 'needs_human'
  const entry: HumanReviewEntry = {
    fingerprint,
    round,
    timestamp: new Date().toISOString(),
    issue: record.issue,
    contradictionCheck,
    conflictingChanges,
  }
  ledger.humanReview.entries.push(entry)
  return entry
}

export async function saveIssueLedger(ledger: IssueLedger): Promise<void> {
  await writeFile(ledger.path, JSON.stringify(ledger.snapshot, null, 2))
}

export async function saveHumanReview(ledger: IssueLedger): Promise<void> {
  await writeFile(ledger.humanReviewPath, JSON.stringify(ledger.humanReview, null, 2))
}

function mapVerifierDecisionToLedgerStatus(verdict: VerifierDecision['verdict']): LedgerIssueStatus {
  switch (verdict) {
    case 'valid':
      return 'verified'
    case 'already_fixed':
      return 'already_fixed'
    case 'needs_human':
      return 'needs_human'
    case 'invalid':
      return 'rejected'
    default:
      throw new Error('Unhandled verifier verdict')
  }
}
