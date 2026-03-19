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

export const ListAgileBoardsRequestSchema = z.object({
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})
