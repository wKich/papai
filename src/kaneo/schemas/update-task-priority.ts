import { z } from 'zod'

export const PriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

export const UpdateTaskPriorityPathParamsSchema = z.object({
  id: z.string(),
})

export const UpdateTaskPriorityRequestSchema = z.object({
  priority: z.string(),
})

export const UpdateTaskPriorityResponseSchema = z.object({
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

export type UpdateTaskPriorityPathParams = z.infer<typeof UpdateTaskPriorityPathParamsSchema>
export type UpdateTaskPriorityRequest = z.infer<typeof UpdateTaskPriorityRequestSchema>
export type UpdateTaskPriorityResponse = z.infer<typeof UpdateTaskPriorityResponseSchema>
export type Priority = z.infer<typeof PriorityEnum>
