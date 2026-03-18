// src/providers/youtrack/schemas/project.ts
import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'
import { UserSchema } from './user.js'

export const ProjectSchema = BaseEntitySchema.extend({
  name: z.string(),
  shortName: z.string(),
  description: z.string().optional(),
  archived: z.boolean().optional(),
  leader: z.lazy(() => UserSchema).optional(),
  createdBy: z.lazy(() => UserSchema).optional(),
  created: TimestampSchema.optional(),
})

export const CreateProjectRequestSchema = z.object({
  name: z.string(),
  shortName: z.string(),
  description: z.string().optional(),
  leader: z.object({ id: z.string() }).optional(),
})

export const CreateProjectResponseSchema = ProjectSchema

export const ListProjectsQuerySchema = z.object({
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})

export const ListProjectsRequestSchema = z.object({
  query: ListProjectsQuerySchema,
})

export const ListProjectsResponseSchema = z.array(ProjectSchema)

export const GetProjectPathSchema = z.object({
  projectId: z.string(),
})

export const GetProjectQuerySchema = z.object({
  fields: z.string().optional(),
})

export const GetProjectRequestSchema = z.object({
  path: GetProjectPathSchema,
  query: GetProjectQuerySchema.optional(),
})

export const GetProjectResponseSchema = ProjectSchema

export const UpdateProjectPathSchema = z.object({
  projectId: z.string(),
})

export const UpdateProjectBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  archived: z.boolean().optional(),
  leader: z.object({ id: z.string() }).optional(),
})

export const UpdateProjectRequestSchema = z.object({
  path: UpdateProjectPathSchema,
  body: UpdateProjectBodySchema,
})

export const UpdateProjectResponseSchema = ProjectSchema

export const DeleteProjectPathSchema = z.object({
  projectId: z.string(),
})

export const DeleteProjectRequestSchema = z.object({
  path: DeleteProjectPathSchema,
})

export type Project = z.infer<typeof ProjectSchema>
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>
export type ListProjectsRequest = z.infer<typeof ListProjectsRequestSchema>
export type ListProjectsResponse = z.infer<typeof ListProjectsResponseSchema>
export type GetProjectRequest = z.infer<typeof GetProjectRequestSchema>
export type GetProjectResponse = z.infer<typeof GetProjectResponseSchema>
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>
export type UpdateProjectResponse = z.infer<typeof UpdateProjectResponseSchema>
export type DeleteProjectRequest = z.infer<typeof DeleteProjectRequestSchema>
