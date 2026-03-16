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
export const CreateActivityRequestSchema = z.object({
  taskId: z.string(),
  userId: z.string(),
  message: z.string(),
  type: z.string(),
})

// Response schema
export const CreateActivityResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: ActivityTypeEnum,
  createdAt: z.object({}),
  userId: z.string().nullable(),
  content: z.string().nullable(),
  externalUserName: z.string().nullable(),
  externalUserAvatar: z.string().nullable(),
  externalSource: z.string().nullable(),
  externalUrl: z.string().nullable(),
})

export type CreateActivityRequest = z.infer<typeof CreateActivityRequestSchema>
export type CreateActivityResponse = z.infer<typeof CreateActivityResponseSchema>
