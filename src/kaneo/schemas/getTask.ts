import { z } from 'zod'

// Enums
export const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

// Path parameters
export const GetTaskPathSchema = z.object({
  id: z.string(),
})

// Request schema (no body)
export const GetTaskRequestSchema = z.object({
  path: GetTaskPathSchema,
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
export const GetTaskResponseSchema = TaskSchema

// TypeScript types
export type TaskPriority = z.infer<typeof TaskPriorityEnum>
export type GetTaskPath = z.infer<typeof GetTaskPathSchema>
export type GetTaskRequest = z.infer<typeof GetTaskRequestSchema>
export type Task = z.infer<typeof TaskSchema>
export type GetTaskResponse = z.infer<typeof GetTaskResponseSchema>
