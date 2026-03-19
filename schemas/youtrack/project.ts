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

export const ListProjectsRequestSchema = z.object({
  query: z.object({
    fields: z.string().optional(),
    $skip: z.number().optional(),
    $top: z.number().optional(),
  }),
})
