import { z } from 'zod'

export const PriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

export const UpdateTaskStatusPathParamsSchema = z.object({
  id: z.string(),
})

export const UpdateTaskStatusRequestSchema = z.object({
  status: z.string(),
})

export const UpdateTaskStatusResponseSchema = z.object({
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

export type UpdateTaskStatusPathParams = z.infer<typeof UpdateTaskStatusPathParamsSchema>
export type UpdateTaskStatusRequest = z.infer<typeof UpdateTaskStatusRequestSchema>
export type UpdateTaskStatusResponse = z.infer<typeof UpdateTaskStatusResponseSchema>
export type Priority = z.infer<typeof PriorityEnum>
