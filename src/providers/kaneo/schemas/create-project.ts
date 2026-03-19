import { z } from 'zod'

// Request body schema
export const CreateProjectRequestSchema = z.object({
  name: z.string(),
  workspaceId: z.string(),
  icon: z.string(),
  slug: z.string(),
})

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>

// Response schema
export const CreateProjectResponseSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.any(),
  isPublic: z.boolean().nullable(),
})

export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>
