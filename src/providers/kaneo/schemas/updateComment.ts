import { z } from 'zod'

// Enums
export const ActivityTypeEnum = z.enum([
  'comment',
  'task',
  'status_changed',
  'priority_changed',
  'unassigned',
  'assignee_changed',
  'due_date_changed',
  'title_changed',
  'description_changed',
  'create',
])

// Request schema
export const UpdateCommentRequestSchema = z.object({
  activityId: z.string(),
  comment: z.string(),
})

// Response schema
export const UpdateCommentResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: ActivityTypeEnum,
  createdAt: z.string().or(z.object({})),
  userId: z.string().nullable(),
  content: z.string().nullable(),
  externalUserName: z.string().nullable(),
  externalUserAvatar: z.string().nullable(),
  externalSource: z.string().nullable(),
  externalUrl: z.string().nullable(),
})

export type UpdateCommentRequest = z.infer<typeof UpdateCommentRequestSchema>
export type UpdateCommentResponse = z.infer<typeof UpdateCommentResponseSchema>
