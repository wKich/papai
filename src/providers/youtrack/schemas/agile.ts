// src/providers/youtrack/schemas/agile.ts
import { z } from 'zod'

import { BaseEntitySchema } from './common.js'

const ProjectReferenceSchema = BaseEntitySchema

export const AgileColumnSchema = BaseEntitySchema.extend({
  name: z.string(),
  ordinal: z.number(),
  issues: z.array(z.object({ id: z.string() })).optional(),
})

export const AgileBoardSchema = BaseEntitySchema.extend({
  name: z.string(),
  projects: z.array(ProjectReferenceSchema),
  columns: z.array(AgileColumnSchema).optional(),
  sprints: z.array(z.object({ id: z.string() })).optional(),
  owner: z.object({ id: z.string() }).optional(),
})

export const ListAgileBoardsQuerySchema = z.object({
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})

export const ListAgileBoardsRequestSchema = ListAgileBoardsQuerySchema

export const ListAgileBoardsResponseSchema = z.array(AgileBoardSchema)

export const GetAgileBoardPathSchema = z.object({
  boardId: z.string(),
})

export const GetAgileBoardQuerySchema = z.object({
  fields: z.string().optional(),
})

export const GetAgileBoardRequestSchema = z.object({
  path: GetAgileBoardPathSchema,
  query: GetAgileBoardQuerySchema.optional(),
})

export const GetAgileBoardResponseSchema = AgileBoardSchema

export const ListAgileColumnsPathSchema = z.object({
  boardId: z.string(),
})

export const ListAgileColumnsRequestSchema = z.object({
  path: ListAgileColumnsPathSchema,
})

export const ListAgileColumnsResponseSchema = z.array(AgileColumnSchema)

export const UpdateAgileColumnPathSchema = z.object({
  boardId: z.string(),
  columnId: z.string(),
})

export const UpdateAgileColumnBodySchema = z.object({
  name: z.string().optional(),
  ordinal: z.number().optional(),
})

export const UpdateAgileColumnRequestSchema = z.object({
  path: UpdateAgileColumnPathSchema,
  body: UpdateAgileColumnBodySchema,
})

export const UpdateAgileColumnResponseSchema = AgileColumnSchema

export type AgileColumn = z.infer<typeof AgileColumnSchema>
export type AgileBoard = z.infer<typeof AgileBoardSchema>
export type ListAgileBoardsRequest = z.infer<typeof ListAgileBoardsRequestSchema>
export type ListAgileBoardsResponse = z.infer<typeof ListAgileBoardsResponseSchema>
export type GetAgileBoardRequest = z.infer<typeof GetAgileBoardRequestSchema>
export type GetAgileBoardResponse = z.infer<typeof GetAgileBoardResponseSchema>
export type ListAgileColumnsRequest = z.infer<typeof ListAgileColumnsRequestSchema>
export type ListAgileColumnsResponse = z.infer<typeof ListAgileColumnsResponseSchema>
export type UpdateAgileColumnRequest = z.infer<typeof UpdateAgileColumnRequestSchema>
export type UpdateAgileColumnResponse = z.infer<typeof UpdateAgileColumnResponseSchema>
