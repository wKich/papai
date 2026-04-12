import { createHash } from 'node:crypto'

import type { ReviewerIssue } from './issue-schema.js'

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ')

export function computeIssueFingerprint(issue: ReviewerIssue): string {
  const source = [
    normalize(issue.file),
    `${issue.lineStart}-${issue.lineEnd}`,
    normalize(issue.title),
    normalize(issue.summary),
  ].join('|')

  return createHash('sha256').update(source).digest('hex').slice(0, 16)
}
