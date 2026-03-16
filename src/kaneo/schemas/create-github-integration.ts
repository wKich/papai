import { z } from 'zod'

export const CreateGitHubIntegrationPathParamsSchema = z.object({
  projectId: z.string(),
})

export const CreateGitHubIntegrationRequestSchema = z.object({
  repositoryOwner: z.string().min(1),
  repositoryName: z.string().min(1),
})

export const CreateGitHubIntegrationResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  repositoryOwner: z.string(),
  repositoryName: z.string(),
  installationId: z.number().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.unknown(),
  updatedAt: z.unknown(),
})

export type CreateGitHubIntegrationPathParams = z.infer<typeof CreateGitHubIntegrationPathParamsSchema>
export type CreateGitHubIntegrationRequest = z.infer<typeof CreateGitHubIntegrationRequestSchema>
export type CreateGitHubIntegrationResponse = z.infer<typeof CreateGitHubIntegrationResponseSchema>
