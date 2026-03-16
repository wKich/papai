import { z } from 'zod'

// Enums
export const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

// Path parameters
export const DeleteTaskPathSchema = z.object({
  id: z.string(),
})

// Request schema (no body)
export const DeleteTaskRequestSchema = z.object({
  path: DeleteTaskPathSchema,
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
export const DeleteTaskResponseSchema = TaskSchema

// TypeScript types
export type TaskPriority = z.infer<typeof TaskPriorityEnum>
export type DeleteTaskPath = z.infer<typeof DeleteTaskPathSchema>
export type DeleteTaskRequest = z.infer<typeof DeleteTaskRequestSchema>
export type Task = z.infer<typeof TaskSchema>
export type DeleteTaskResponse = z.infer<typeof DeleteTaskResponseSchema>
