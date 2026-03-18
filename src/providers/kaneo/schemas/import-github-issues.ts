import { z } from 'zod'

export const ImportGitHubIssuesRequestSchema = z.object({
  projectId: z.string(),
})

export const ImportGitHubIssuesResponseSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  errors: z.array(z.string()).optional(),
})

export type ImportGitHubIssuesRequest = z.infer<typeof ImportGitHubIssuesRequestSchema>
export type ImportGitHubIssuesResponse = z.infer<typeof ImportGitHubIssuesResponseSchema>
