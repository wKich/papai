import { z } from 'zod'

// Path parameters
export const UpdateProjectPathSchema = z.object({
  id: z.string(),
})

// Request body schema
export const UpdateProjectBodySchema = z.object({
  name: z.string(),
  icon: z.string(),
  slug: z.string(),
  description: z.string(),
  isPublic: z.boolean(),
})

// Request schema
export const UpdateProjectRequestSchema = z.object({
  path: UpdateProjectPathSchema,
  body: UpdateProjectBodySchema,
})

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

// Response schema
export const UpdateProjectResponseSchema = ProjectSchema

// TypeScript types
export type UpdateProjectPath = z.infer<typeof UpdateProjectPathSchema>
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>
export type Project = z.infer<typeof ProjectSchema>
export type UpdateProjectResponse = z.infer<typeof UpdateProjectResponseSchema>
