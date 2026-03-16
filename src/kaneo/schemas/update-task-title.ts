import { z } from 'zod'

export const PriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

export const UpdateTaskTitlePathParamsSchema = z.object({
  id: z.string(),
})

export const UpdateTaskTitleRequestSchema = z.object({
  title: z.string(),
})

export const UpdateTaskTitleResponseSchema = z.object({
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

export type UpdateTaskTitlePathParams = z.infer<typeof UpdateTaskTitlePathParamsSchema>
export type UpdateTaskTitleRequest = z.infer<typeof UpdateTaskTitleRequestSchema>
export type UpdateTaskTitleResponse = z.infer<typeof UpdateTaskTitleResponseSchema>
export type Priority = z.infer<typeof PriorityEnum>
