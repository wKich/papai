import { z } from 'zod'

export const VerifyGitHubInstallationRequestSchema = z.object({
  repositoryOwner: z.string().min(1),
  repositoryName: z.string().min(1),
})

export const VerifyGitHubInstallationResponseSchema = z.object({
  installed: z.boolean(),
  message: z.string().optional(),
})

export type VerifyGitHubInstallationRequest = z.infer<typeof VerifyGitHubInstallationRequestSchema>
export type VerifyGitHubInstallationResponse = z.infer<typeof VerifyGitHubInstallationResponseSchema>
