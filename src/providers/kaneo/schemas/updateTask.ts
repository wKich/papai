import { z } from 'zod'

// Enums
export const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

// Path parameters
export const UpdateTaskPathSchema = z.object({
  id: z.string(),
})

// Request body schema
export const UpdateTaskBodySchema = z.object({
  title: z.string(),
  description: z.string(),
  dueDate: z.string().optional(),
  priority: z.string(),
  status: z.string(),
  projectId: z.string(),
  position: z.number(),
  userId: z.string().optional(),
})

// Request schema
export const UpdateTaskRequestSchema = z.object({
  path: UpdateTaskPathSchema,
  body: UpdateTaskBodySchema,
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
export const UpdateTaskResponseSchema = TaskSchema

// TypeScript types
export type TaskPriority = z.infer<typeof TaskPriorityEnum>
export type UpdateTaskPath = z.infer<typeof UpdateTaskPathSchema>
export type UpdateTaskBody = z.infer<typeof UpdateTaskBodySchema>
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>
export type Task = z.infer<typeof TaskSchema>
export type UpdateTaskResponse = z.infer<typeof UpdateTaskResponseSchema>
