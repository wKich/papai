// src/providers/youtrack/schemas/comment.ts
import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'
import { UserReferenceSchema } from './user.js'

export const CommentSchema = BaseEntitySchema.extend({
  text: z.string(),
  textPreview: z.string().optional(),
  author: z.lazy(() => UserReferenceSchema),
  created: TimestampSchema,
  updated: TimestampSchema.optional(),
  deleted: z.boolean().optional(),
  pinned: z.boolean().optional(),
})

export const ListCommentsRequestSchema = z.object({
  path: z.object({
    issueId: z.string(),
  }),
  query: z
    .object({
      fields: z.string().optional(),
    })
    .optional(),
})

export const CreateCommentRequestSchema = z.object({
  path: z.object({
    issueId: z.string(),
  }),
  body: z.object({
    text: z.string(),
  }),
})

export const UpdateCommentRequestSchema = z.object({
  path: z.object({
    issueId: z.string(),
    commentId: z.string(),
  }),
  body: z.object({
    text: z.string(),
  }),
})
