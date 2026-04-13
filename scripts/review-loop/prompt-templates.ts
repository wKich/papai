import type { LedgerIssueRecord } from './issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from './issue-schema.js'

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
