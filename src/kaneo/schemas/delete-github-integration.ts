import { z } from 'zod'

export const DeleteGitHubIntegrationPathParamsSchema = z.object({
  projectId: z.string(),
})

export const DeleteGitHubIntegrationResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  repositoryOwner: z.string(),
  repositoryName: z.string(),
  installationId: z.number().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.unknown(),
  updatedAt: z.unknown(),
})

export type DeleteGitHubIntegrationPathParams = z.infer<typeof DeleteGitHubIntegrationPathParamsSchema>
export type DeleteGitHubIntegrationResponse = z.infer<typeof DeleteGitHubIntegrationResponseSchema>
