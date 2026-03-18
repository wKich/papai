import { z } from 'zod'

// Path parameters
export const ListProjectsPathSchema = z.object({})

// Query parameters
export const ListProjectsQuerySchema = z.object({
  workspaceId: z.string(),
})

// Request schema (no body)
export const ListProjectsRequestSchema = z.object({
  query: ListProjectsQuerySchema,
})

// Project schema (list item)
export const ProjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.unknown(),
  isPublic: z.boolean().nullable(),
})

// Response schema
export const ListProjectsResponseSchema = z.array(ProjectSchema)

// TypeScript types
export type ListProjectsPath = z.infer<typeof ListProjectsPathSchema>
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>
export type ListProjectsRequest = z.infer<typeof ListProjectsRequestSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ListProjectsResponse = z.infer<typeof ListProjectsResponseSchema>
