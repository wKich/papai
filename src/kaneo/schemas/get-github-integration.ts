import { z } from 'zod'

export const GetGitHubIntegrationPathParamsSchema = z.object({
  projectId: z.string(),
})

export const GetGitHubIntegrationResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  repositoryOwner: z.string(),
  repositoryName: z.string(),
  installationId: z.number().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.unknown(),
  updatedAt: z.unknown(),
})

export type GetGitHubIntegrationPathParams = z.infer<typeof GetGitHubIntegrationPathParamsSchema>
export type GetGitHubIntegrationResponse = z.infer<typeof GetGitHubIntegrationResponseSchema>
