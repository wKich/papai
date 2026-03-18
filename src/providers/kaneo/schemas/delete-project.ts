import { z } from 'zod'

// Path parameters
export const DeleteProjectPathParamsSchema = z.object({
  id: z.string(),
})

// Response schema
export const DeleteProjectResponseSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.any(),
  isPublic: z.boolean().nullable(),
})

export type DeleteProjectPathParams = z.infer<typeof DeleteProjectPathParamsSchema>
export type DeleteProjectResponse = z.infer<typeof DeleteProjectResponseSchema>
