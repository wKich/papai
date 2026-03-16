import { z } from 'zod'

// Enums
export const NotificationTypeEnum = z.enum([
  'info',
  'task_created',
  'workspace_created',
  'task_status_changed',
  'task_assignee_changed',
  'time_entry_created',
])

export const ResourceTypeEnum = z.enum(['task', 'workspace'])

export type NotificationType = z.infer<typeof NotificationTypeEnum>
export type ResourceType = z.infer<typeof ResourceTypeEnum>

// Request body schema
export const CreateNotificationRequestSchema = z.object({
  userId: z.string(),
  title: z.string(),
  message: z.string(),
  type: z.string(),
  relatedEntityId: z.string().optional(),
  relatedEntityType: z.string().optional(),
})

// Response schema
export const CreateNotificationResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  content: z.string().nullable(),
  type: NotificationTypeEnum,
  isRead: z.boolean().optional(),
  resourceId: z.string().optional(),
  resourceType: ResourceTypeEnum.optional(),
  createdAt: z.any(),
})

export type CreateNotificationRequest = z.infer<typeof CreateNotificationRequestSchema>
export type CreateNotificationResponse = z.infer<typeof CreateNotificationResponseSchema>
