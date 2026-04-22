import type { FixChangeRecord, LedgerIssueRecord } from './issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from './issue-schema.js'

export interface PriorFixChangeForPrompt {
  fingerprint: string
  issueTitle: string
  change: FixChangeRecord
}

function summarizeLedger(records: readonly LedgerIssueRecord[]): string {
  if (records.length === 0) {
    return 'No prior issues recorded.'
  }

  return records.map((record) => `- ${record.fingerprint} [${record.status}] ${record.issue.title}`).join('\n')
}

export function buildReviewPrompt(planPath: string, ledgerRecords: readonly LedgerIssueRecord[]): string {
  return [
    `Review the current implementation against the implementation plan at: ${planPath}.`,
    'Return JSON only.',
    'Only include severity critical or high findings.',
    'Use this exact schema:',
    '{"round": number, "issues": [{"title": string, "severity": "critical" | "high", "summary": string, "whyItMatters": string, "evidence": string, "file": string, "lineStart": number, "lineEnd": number, "suggestedFix": string, "confidence": number}]}',
    'Prior issue ledger:',
    summarizeLedger(ledgerRecords),
  ].join('\n\n')
}

export function buildVerifyPrompt(planPath: string, issue: ReviewerIssue): string {
  return [
    `Verify this issue against the implementation plan at: ${planPath}.`,
    'Return JSON only.',
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixPlan": string}',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}

export function buildFixPrompt(issue: ReviewerIssue, decision: VerifierDecision): string {
  return [
    'Fix exactly the verified issue below.',
    'Keep the fix minimal and do not broaden scope unless required for correctness.',
    'You may run targeted repo-safe tests or formatters.',
    'Issue:',
    JSON.stringify(issue, null, 2),
    'Verifier decision:',
    JSON.stringify(decision, null, 2),
  ].join('\n\n')
}

export function buildRereviewPrompt(planPath: string, ledgerRecords: readonly LedgerIssueRecord[]): string {
  return [
    `Re-review the current implementation against the implementation plan at: ${planPath}.`,
    'Return JSON only with remaining critical/high issues.',
    'Confirm whether previously fixed issues are resolved and report only unresolved or newly introduced critical/high issues.',
    'Use the same schema as the original review prompt.',
    'Current issue ledger:',
    summarizeLedger(ledgerRecords),
  ].join('\n\n')
}

export function buildFixDescriptionPrompt(issue: ReviewerIssue, files: readonly string[], diff: string): string {
  return [
    'Describe the code changes just made to fix the issue below. Return JSON only.',
    'Use this exact schema:',
    '{"whatChanged": string, "whyChanged": string}',
    '- whatChanged: a concise human-readable summary of the actual code changes (what was edited, added, or removed).',
    '- whyChanged: the reason for these changes, linked back to the issue being fixed.',
    'Issue being fixed:',
    JSON.stringify(issue, null, 2),
    `Files changed: ${files.length === 0 ? '(none detected)' : files.join(', ')}`,
    'Git diff of changes:',
    diff.length === 0 ? '(no diff captured)' : diff,
  ].join('\n\n')
}

function summarizePriorFixChanges(priorChanges: readonly PriorFixChangeForPrompt[]): string {
  if (priorChanges.length === 0) {
    return 'No prior fix changes recorded.'
  }
  return priorChanges
    .map(
      (entry, index) =>
        `[${index}] Issue: ${entry.issueTitle} (${entry.fingerprint}) @ round ${entry.change.round}\n` +
        `  files: ${entry.change.files.join(', ') || '(none)'}\n` +
        `  whatChanged: ${entry.change.whatChanged}\n` +
        `  whyChanged: ${entry.change.whyChanged}`,
    )
    .join('\n\n')
}

export function buildContradictionCheckPrompt(
  issue: ReviewerIssue,
  priorChanges: readonly PriorFixChangeForPrompt[],
): string {
  return [
    'Before verifying the issue below, check whether any prior fix changes in this run contradict it.',
    'A contradiction exists when a prior fix already changed behavior in a way that makes this issue moot, reversed, or in direct conflict — for example, a prior fix that implements the opposite of what this issue now asks for, or that already addresses the same root cause from a conflicting angle.',
    'Return JSON only with this exact schema:',
    '{"contradicts": boolean, "reasoning": string, "conflictingChangeIndices": number[]}',
    '- contradicts: true only if at least one prior change contradicts this issue.',
    '- reasoning: a short explanation suitable for a human reviewer.',
    '- conflictingChangeIndices: zero-based indices into the prior-change list below when contradicts is true; otherwise an empty array.',
    'Issue being verified:',
    JSON.stringify(issue, null, 2),
    'Prior fix changes:',
    summarizePriorFixChanges(priorChanges),
  ].join('\n\n')
}
