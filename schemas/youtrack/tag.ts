// src/providers/youtrack/schemas/tag.ts
import { z } from 'zod'

import { BaseEntitySchema } from './common.js'

const FieldStyleSchema = z.object({
  $type: z.string().optional(),
  id: z.string().optional(),
  background: z.string(),
  foreground: z.string().optional(),
})

export const TagSchema = BaseEntitySchema.extend({
  name: z.string(),
  color: FieldStyleSchema.optional(),
  untagOnResolve: z.boolean().optional(),
  owner: z.object({ id: z.string() }).optional(),
})

export const CreateTagRequestSchema = z.object({
  name: z.string(),
  color: FieldStyleSchema.optional(),
  untagOnResolve: z.boolean().optional(),
})

export const ListTagsRequestSchema = z.object({
  query: z.object({
    fields: z.string().optional(),
    $skip: z.number().optional(),
    $top: z.number().optional(),
  }),
})

export const AddTagToIssueRequestSchema = z.object({
  path: z.object({
    issueId: z.string(),
  }),
  body: z.object({
    id: z.string(),
    $type: z.string().optional(),
  }),
})

export const RemoveTagFromIssueRequestSchema = z.object({
  path: z.object({
    issueId: z.string(),
    tagId: z.string(),
  }),
})
