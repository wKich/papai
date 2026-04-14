import { describe, expect, test } from 'bun:test'

import type { LedgerIssueRecord } from '../../scripts/review-loop/issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from '../../scripts/review-loop/issue-schema.js'
import {
  buildFixPrompt,
  buildRereviewPrompt,
  buildReviewPrompt,
  buildVerifyPrompt,
} from '../../scripts/review-loop/prompt-templates.js'

const reviewerIssue: ReviewerIssue = {
  title: 'Missing validation',
  severity: 'high',
  summary: 'Validation is skipped for permission requests.',
  whyItMatters: 'Unsafe permission decisions can escape the repo sandbox.',
  evidence: 'decidePermissionOptionId allows unsafe args',
  file: 'scripts/review-loop/permission-policy.ts',
  lineStart: 10,
  lineEnd: 20,
  suggestedFix: 'Validate commands and paths before auto-allowing them.',
  confidence: 0.9,
}

const verifierDecision: VerifierDecision = {
  verdict: 'valid',
  fixability: 'auto',
  reasoning: 'The policy is too permissive and can be tightened safely.',
  targetFiles: ['scripts/review-loop/permission-policy.ts'],
  fixPlan: 'Add stricter path validation and shell-token checks.',
}

const ledgerRecord: LedgerIssueRecord = {
  fingerprint: 'issue-1',
  issue: reviewerIssue,
  status: 'verified',
  firstSeenRound: 1,
  latestSeenRound: 1,
  fixAttempts: 0,
  verifierDecision,
}

describe('prompt templates', () => {
  test('buildReviewPrompt includes the plan path, schema, and ledger summary', () => {
    const prompt = buildReviewPrompt('/repo/plan.md', [ledgerRecord])

    expect(prompt).toContain('Review the current implementation against the implementation plan at: /repo/plan.md.')
    expect(prompt).toContain('"severity": "critical" | "high"')
    expect(prompt).toContain('- issue-1 [verified] Missing validation')
  })

  test('buildVerifyPrompt includes the verification schema and issue payload', () => {
    const prompt = buildVerifyPrompt('/repo/plan.md', reviewerIssue)

    expect(prompt).toContain('Verify this issue against the implementation plan at: /repo/plan.md.')
    expect(prompt).toContain('"verdict": "valid" | "invalid" | "already_fixed" | "needs_human"')
    expect(prompt).toContain('"title": "Missing validation"')
  })

  test('buildFixPrompt includes the issue and verifier decision payloads', () => {
    const prompt = buildFixPrompt(reviewerIssue, verifierDecision)

    expect(prompt).toContain('Fix exactly the verified issue below.')
    expect(prompt).toContain('"title": "Missing validation"')
    expect(prompt).toContain('"verdict": "valid"')
  })

  test('buildRereviewPrompt includes empty-ledger fallback text', () => {
    const prompt = buildRereviewPrompt('/repo/plan.md', [])

    expect(prompt).toContain('Re-review the current implementation against the implementation plan at: /repo/plan.md.')
    expect(prompt).toContain('Use the same schema as the original review prompt.')
    expect(prompt).toContain('No prior issues recorded.')
  })
})
