import { describe, expect, test } from 'bun:test'

import {
  parseContradictionCheck,
  parseFixDescription,
  parseReviewerIssues,
  parseVerifierDecision,
} from '../../scripts/review-loop/issue-schema.js'

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

  test('parseReviewerIssues accepts fenced JSON with surrounding text', () => {
    const parsed = parseReviewerIssues(
      [
        'Here is the structured review output:',
        '',
        '```json',
        '{"round":2,"issues":[]}',
        '```',
        '',
        'That is the full result.',
      ].join('\n'),
    )

    expect(parsed.round).toBe(2)
    expect(parsed.issues).toHaveLength(0)
  })

  test('parseVerifierDecision accepts lightly wrapped JSON', () => {
    const parsed = parseVerifierDecision(
      `Verifier result follows.

{"verdict":"valid","fixability":"auto","reasoning":"Looks good.","targetFiles":["src/app.ts"],"fixPlan":"No changes required."}

End result.`,
    )

    expect(parsed.verdict).toBe('valid')
    expect(parsed.targetFiles).toEqual(['src/app.ts'])
  })

  test('parseReviewerIssues rejects ambiguous multi-json responses', () => {
    expect(() =>
      parseReviewerIssues(`{"round":1,"issues":[]}
{"round":2,"issues":[]}`),
    ).toThrow()
  })

  test('parseVerifierDecision rejects freeform prose', () => {
    expect(() => parseVerifierDecision('looks valid to me')).toThrow(
      'Expected exactly one JSON object for verifier decision',
    )
  })

  test('parseFixDescription accepts structured JSON with both fields', () => {
    const parsed = parseFixDescription(
      JSON.stringify({ whatChanged: 'Moved the lock.', whyChanged: 'Prevents a race.' }),
    )
    expect(parsed.whatChanged).toBe('Moved the lock.')
    expect(parsed.whyChanged).toBe('Prevents a race.')
  })

  test('parseContradictionCheck accepts structured JSON', () => {
    const parsed = parseContradictionCheck(
      JSON.stringify({ contradicts: true, reasoning: 'Prior fix reversed this.', conflictingChangeIndices: [0, 1] }),
    )
    expect(parsed.contradicts).toBe(true)
    expect(parsed.conflictingChangeIndices).toEqual([0, 1])
  })

  test('parseContradictionCheck defaults conflictingChangeIndices to empty', () => {
    const parsed = parseContradictionCheck(JSON.stringify({ contradicts: false, reasoning: 'No conflicts.' }))
    expect(parsed.conflictingChangeIndices).toEqual([])
  })
})
