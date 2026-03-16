import { z } from 'zod'

export const UpdateGitHubIntegrationPathParamsSchema = z.object({
  projectId: z.string(),
})

export const UpdateGitHubIntegrationRequestSchema = z.object({
  isActive: z.boolean().optional(),
})

export const UpdateGitHubIntegrationResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  repositoryOwner: z.string(),
  repositoryName: z.string(),
  installationId: z.number().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.unknown(),
  updatedAt: z.unknown(),
})

export const UpdateGitHubIntegrationErrorResponseSchema = z.object({
  error: z.string(),
})

export type UpdateGitHubIntegrationPathParams = z.infer<typeof UpdateGitHubIntegrationPathParamsSchema>
export type UpdateGitHubIntegrationRequest = z.infer<typeof UpdateGitHubIntegrationRequestSchema>
export type UpdateGitHubIntegrationResponse = z.infer<typeof UpdateGitHubIntegrationResponseSchema>
export type UpdateGitHubIntegrationErrorResponse = z.infer<typeof UpdateGitHubIntegrationErrorResponseSchema>
