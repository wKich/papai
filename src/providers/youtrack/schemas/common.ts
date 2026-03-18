// src/providers/youtrack/schemas/common.ts
import { z } from 'zod'

export const IssueStateEnum = z.enum([
  'Open',
  'In Progress',
  'Wait for Reply',
  'Reopened',
  'Resolved',
  'Closed',
  'Canceled',
])

export const IssuePriorityEnum = z.enum(['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor', 'Cosmetic'])

export const LinkTypeEnum = z.enum(['Relates', 'Depend', 'Duplicate', 'Subtask'])

export const BaseEntitySchema = z.object({
  id: z.string(),
  $type: z.string(),
})

export const TimestampSchema = z.number().int().positive()

export type IssueState = z.infer<typeof IssueStateEnum>
export type IssuePriority = z.infer<typeof IssuePriorityEnum>
export type LinkType = z.infer<typeof LinkTypeEnum>
export type BaseEntity = z.infer<typeof BaseEntitySchema>
