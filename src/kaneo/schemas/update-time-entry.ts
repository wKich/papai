import { z } from 'zod'

export const UpdateTimeEntryPathParamsSchema = z.object({
  id: z.string(),
})

export const UpdateTimeEntryRequestSchema = z.object({
  startTime: z.string(),
  endTime: z.string().optional(),
  description: z.string().optional(),
})

export const UpdateTimeEntryResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string().nullable(),
  description: z.string().nullable(),
  startTime: z.unknown(),
  endTime: z.unknown().optional(),
  duration: z.number().nullable(),
  createdAt: z.unknown(),
})

export type UpdateTimeEntryPathParams = z.infer<typeof UpdateTimeEntryPathParamsSchema>
export type UpdateTimeEntryRequest = z.infer<typeof UpdateTimeEntryRequestSchema>
export type UpdateTimeEntryResponse = z.infer<typeof UpdateTimeEntryResponseSchema>
