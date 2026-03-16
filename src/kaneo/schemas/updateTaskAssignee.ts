import { z } from 'zod'

// Enums
export const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

// Path parameters
export const UpdateTaskAssigneePathSchema = z.object({
  id: z.string(),
})

// Request body schema
export const UpdateTaskAssigneeBodySchema = z.object({
  userId: z.string(),
})

// Request schema
export const UpdateTaskAssigneeRequestSchema = z.object({
  path: UpdateTaskAssigneePathSchema,
  body: UpdateTaskAssigneeBodySchema,
})

// Task schema (response)
export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  position: z.number().nullable(),
  number: z.number().nullable(),
  userId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: TaskPriorityEnum,
  dueDate: z.unknown().optional(),
  createdAt: z.unknown(),
})

// Response schema
export const UpdateTaskAssigneeResponseSchema = TaskSchema

// TypeScript types
export type TaskPriority = z.infer<typeof TaskPriorityEnum>
export type UpdateTaskAssigneePath = z.infer<typeof UpdateTaskAssigneePathSchema>
export type UpdateTaskAssigneeBody = z.infer<typeof UpdateTaskAssigneeBodySchema>
export type UpdateTaskAssigneeRequest = z.infer<typeof UpdateTaskAssigneeRequestSchema>
export type Task = z.infer<typeof TaskSchema>
export type UpdateTaskAssigneeResponse = z.infer<typeof UpdateTaskAssigneeResponseSchema>
