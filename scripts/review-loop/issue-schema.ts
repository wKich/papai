import { z } from 'zod'

export const ReviewerIssueSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(['critical', 'high']),
  summary: z.string().min(1),
  whyItMatters: z.string().min(1),
  evidence: z.string().min(1),
  file: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  suggestedFix: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export const ReviewerIssuesSchema = z.object({
  round: z.number().int().nonnegative(),
  issues: z.array(ReviewerIssueSchema),
})

export const VerifierDecisionSchema = z.object({
  verdict: z.enum(['valid', 'invalid', 'already_fixed', 'needs_human']),
  fixability: z.enum(['auto', 'manual']),
  reasoning: z.string().min(1),
  targetFiles: z.array(z.string().min(1)),
  fixPlan: z.string().min(1),
})

export type ReviewerIssue = z.infer<typeof ReviewerIssueSchema>
export type ReviewerIssues = z.infer<typeof ReviewerIssuesSchema>
export type VerifierDecision = z.infer<typeof VerifierDecisionSchema>

export function parseReviewerIssues(text: string): ReviewerIssues {
  return ReviewerIssuesSchema.parse(JSON.parse(text))
}

export function parseVerifierDecision(text: string): VerifierDecision {
  return VerifierDecisionSchema.parse(JSON.parse(text))
}
