import { z } from 'zod'

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
