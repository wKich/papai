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

export const ListCommentsPathSchema = z.object({
  issueId: z.string(),
})

export const ListCommentsQuerySchema = z.object({
  fields: z.string().optional(),
})

export const ListCommentsRequestSchema = z.object({
  path: ListCommentsPathSchema,
  query: ListCommentsQuerySchema.optional(),
})

export const ListCommentsResponseSchema = z.array(CommentSchema)

export const CreateCommentPathSchema = z.object({
  issueId: z.string(),
})

export const CreateCommentBodySchema = z.object({
  text: z.string(),
})

export const CreateCommentRequestSchema = z.object({
  path: CreateCommentPathSchema,
  body: CreateCommentBodySchema,
})

export const CreateCommentResponseSchema = CommentSchema

export const UpdateCommentPathSchema = z.object({
  issueId: z.string(),
  commentId: z.string(),
})

export const UpdateCommentBodySchema = z.object({
  text: z.string(),
})

export const UpdateCommentRequestSchema = z.object({
  path: UpdateCommentPathSchema,
  body: UpdateCommentBodySchema,
})

export const UpdateCommentResponseSchema = CommentSchema

export const DeleteCommentPathSchema = z.object({
  issueId: z.string(),
  commentId: z.string(),
})

export const DeleteCommentRequestSchema = z.object({
  path: DeleteCommentPathSchema,
})

export type Comment = z.infer<typeof CommentSchema>
export type ListCommentsRequest = z.infer<typeof ListCommentsRequestSchema>
export type ListCommentsResponse = z.infer<typeof ListCommentsResponseSchema>
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>
export type CreateCommentResponse = z.infer<typeof CreateCommentResponseSchema>
export type UpdateCommentRequest = z.infer<typeof UpdateCommentRequestSchema>
export type UpdateCommentResponse = z.infer<typeof UpdateCommentResponseSchema>
export type DeleteCommentRequest = z.infer<typeof DeleteCommentRequestSchema>
