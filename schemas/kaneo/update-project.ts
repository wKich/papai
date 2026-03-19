import { z } from 'zod'

// Project schema (response)
export const ProjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string().optional(),
  slug: z.string(),
  icon: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  createdAt: z.unknown().optional(),
  isPublic: z.boolean().nullable().optional(),
})

// TypeScript types
export type Project = z.infer<typeof ProjectSchema>
