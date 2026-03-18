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

// Notification item schema
const NotificationSchema = z.object({
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

// Response schema (array of notifications)
export const ListNotificationsResponseSchema = z.array(NotificationSchema)

export type ListNotificationsResponse = z.infer<typeof ListNotificationsResponseSchema>
