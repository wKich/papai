import { z } from 'zod'

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
