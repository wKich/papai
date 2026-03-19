// src/providers/youtrack/schemas/issue.ts
import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'
import { CustomFieldValueSchema } from './custom-fields.js'
import { TagSchema } from './tag.js'
import { UserSchema } from './user.js'

export const IssueSchema = BaseEntitySchema.extend({
  idReadable: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  project: BaseEntitySchema.extend({
    name: z.string().optional(),
    shortName: z.string().optional(),
  }),
  reporter: z.lazy(() => UserSchema).optional(),
  updater: z.lazy(() => UserSchema).optional(),
  created: TimestampSchema,
  updated: TimestampSchema,
  resolved: TimestampSchema.optional(),
  customFields: z.array(CustomFieldValueSchema),
  tags: z.array(z.lazy(() => TagSchema)).optional(),
  commentsCount: z.number().optional(),
  votes: z.number().optional(),
})

export const CreateIssueRequestSchema = z.object({
  summary: z.string(),
  description: z.string().optional(),
  project: z.object({ id: z.string() }),
  customFields: z
    .array(
      z.object({
        name: z.string(),
        $type: z.string(),
        value: z.unknown(),
      }),
    )
    .optional(),
  tags: z.array(z.object({ id: z.string() })).optional(),
})

export const SearchIssuesRequestSchema = z.object({
  query: z.string().optional(),
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})
