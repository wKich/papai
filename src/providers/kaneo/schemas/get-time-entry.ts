import { z } from 'zod'

export const GetTimeEntryPathParamsSchema = z.object({
  id: z.string(),
})

export const GetTimeEntryResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string().nullable(),
  description: z.string().nullable(),
  startTime: z.unknown(),
  endTime: z.unknown().optional(),
  duration: z.number().nullable(),
  createdAt: z.unknown(),
})

export type GetTimeEntryPathParams = z.infer<typeof GetTimeEntryPathParamsSchema>
export type GetTimeEntryResponse = z.infer<typeof GetTimeEntryResponseSchema>
