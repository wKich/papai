// src/providers/youtrack/schemas/issue.ts
import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'
import { CustomFieldValueSchema } from './custom-fields.js'
import { IssueLinkSchema } from './issue-link.js'
import { TagSchema } from './tag.js'
import { UserSchema } from './user.js'

export const IssueSchema = BaseEntitySchema.extend({
  idReadable: z.string(),
  numberInProject: z.number().optional(),
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
  links: z.array(IssueLinkSchema).optional(),
  commentsCount: z.number().optional(),
  votes: z.number().optional(),
  attachments: z.array(z.unknown()).optional(),
  visibility: z.unknown().optional(),
  parent: z
    .object({
      issues: z.array(
        z.object({
          id: z.string(),
          idReadable: z.string().optional(),
          summary: z.string(),
        }),
      ),
    })
    .optional(),
  subtasks: z
    .object({
      issues: z.array(
        z.object({
          id: z.string(),
          idReadable: z.string().optional(),
          summary: z.string(),
          resolved: TimestampSchema.optional(),
        }),
      ),
    })
    .optional(),
})

/** Lighter schema matching ISSUE_LIST_FIELDS (no created/updated/tags/links). */
export const IssueListSchema = z.object({
  id: z.string(),
  $type: z.string().optional(),
  idReadable: z.string().optional(),
  numberInProject: z.number().optional(),
  summary: z.string(),
  resolved: TimestampSchema.optional(),
  project: BaseEntitySchema.extend({
    name: z.string().optional(),
    shortName: z.string().optional(),
  }).optional(),
  customFields: z.array(CustomFieldValueSchema).optional(),
})
