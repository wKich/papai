import { z } from 'zod'

export const GetTaskTimeEntriesPathParamsSchema = z.object({
  taskId: z.string(),
})

export const TimeEntrySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string().nullable(),
  description: z.string().nullable(),
  startTime: z.unknown(),
  endTime: z.unknown().optional(),
  duration: z.number().nullable(),
  createdAt: z.unknown(),
})

export const GetTaskTimeEntriesResponseSchema = z.array(TimeEntrySchema)

export type GetTaskTimeEntriesPathParams = z.infer<typeof GetTaskTimeEntriesPathParamsSchema>
export type TimeEntry = z.infer<typeof TimeEntrySchema>
export type GetTaskTimeEntriesResponse = z.infer<typeof GetTaskTimeEntriesResponseSchema>
