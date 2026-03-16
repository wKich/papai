import { z } from 'zod'

// Path parameters
export const GetProjectPathParamsSchema = z.object({
  id: z.string(),
})

// Query parameters
export const GetProjectQueryParamsSchema = z.object({
  workspaceId: z.string(),
})

// Response schema
export const GetProjectResponseSchema = z.object({
  id: z.string(),
  workspaceId: z.string().optional(),
  slug: z.string(),
  icon: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  createdAt: z.any().optional(),
  isPublic: z.boolean().nullable().optional(),
})

export type GetProjectPathParams = z.infer<typeof GetProjectPathParamsSchema>
export type GetProjectQueryParams = z.infer<typeof GetProjectQueryParamsSchema>
export type GetProjectResponse = z.infer<typeof GetProjectResponseSchema>
