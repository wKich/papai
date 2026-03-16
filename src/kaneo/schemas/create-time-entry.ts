import { z } from 'zod'

export const CreateTimeEntryRequestSchema = z.object({
  taskId: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  description: z.string().optional(),
})

export const CreateTimeEntryResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string().nullable(),
  description: z.string().nullable(),
  startTime: z.unknown(),
  endTime: z.unknown().optional(),
  duration: z.number().nullable(),
  createdAt: z.unknown(),
})

export type CreateTimeEntryRequest = z.infer<typeof CreateTimeEntryRequestSchema>
export type CreateTimeEntryResponse = z.infer<typeof CreateTimeEntryResponseSchema>
