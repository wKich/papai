import { z } from 'zod'

// Enums
export const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

// Path parameters
export const CreateTaskPathSchema = z.object({
  projectId: z.string(),
})

// Request body schema
export const CreateTaskBodySchema = z.object({
  title: z.string(),
  description: z.string(),
  dueDate: z.string().optional(),
  priority: z.string(),
  status: z.string(),
  userId: z.string().optional(),
})

// Request schema
export const CreateTaskRequestSchema = z.object({
  path: CreateTaskPathSchema,
  body: CreateTaskBodySchema,
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
export const CreateTaskResponseSchema = TaskSchema

// TypeScript types
export type TaskPriority = z.infer<typeof TaskPriorityEnum>
export type CreateTaskPath = z.infer<typeof CreateTaskPathSchema>
export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>
export type Task = z.infer<typeof TaskSchema>
export type CreateTaskResponse = z.infer<typeof CreateTaskResponseSchema>
