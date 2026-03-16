import { z } from 'zod'

export const PriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

export const UpdateTaskDueDatePathParamsSchema = z.object({
  id: z.string(),
})

export const UpdateTaskDueDateRequestSchema = z.object({
  dueDate: z.string().optional(),
})

export const UpdateTaskDueDateResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  position: z.number().nullable(),
  number: z.number().nullable(),
  userId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: PriorityEnum,
  dueDate: z.object({}).optional(),
  createdAt: z.object({}),
})

export type UpdateTaskDueDatePathParams = z.infer<typeof UpdateTaskDueDatePathParamsSchema>
export type UpdateTaskDueDateRequest = z.infer<typeof UpdateTaskDueDateRequestSchema>
export type UpdateTaskDueDateResponse = z.infer<typeof UpdateTaskDueDateResponseSchema>
export type Priority = z.infer<typeof PriorityEnum>
