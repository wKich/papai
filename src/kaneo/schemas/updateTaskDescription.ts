import { z } from 'zod'

// Enums
export const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

// Path parameters
export const UpdateTaskDescriptionPathSchema = z.object({
  id: z.string(),
})

// Request body schema
export const UpdateTaskDescriptionBodySchema = z.object({
  description: z.string(),
})

// Request schema
export const UpdateTaskDescriptionRequestSchema = z.object({
  path: UpdateTaskDescriptionPathSchema,
  body: UpdateTaskDescriptionBodySchema,
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
export const UpdateTaskDescriptionResponseSchema = TaskSchema

// TypeScript types
export type TaskPriority = z.infer<typeof TaskPriorityEnum>
export type UpdateTaskDescriptionPath = z.infer<typeof UpdateTaskDescriptionPathSchema>
export type UpdateTaskDescriptionBody = z.infer<typeof UpdateTaskDescriptionBodySchema>
export type UpdateTaskDescriptionRequest = z.infer<typeof UpdateTaskDescriptionRequestSchema>
export type Task = z.infer<typeof TaskSchema>
export type UpdateTaskDescriptionResponse = z.infer<typeof UpdateTaskDescriptionResponseSchema>
