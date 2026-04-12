import { describe, expect, test } from 'bun:test'

import { parseReviewerIssues, parseVerifierDecision } from '../../scripts/review-loop/issue-schema.js'

describe('issue schema parsing', () => {
  test('parseReviewerIssues accepts structured critical/high issues', () => {
    const parsed = parseReviewerIssues(
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
    )

    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0]?.severity).toBe('high')
  })

  test('parseVerifierDecision rejects freeform prose', () => {
    expect(() => parseVerifierDecision('looks valid to me')).toThrow()
  })
})
