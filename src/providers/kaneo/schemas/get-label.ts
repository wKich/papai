import { z } from 'zod'

// Path parameters
export const GetLabelPathParamsSchema = z.object({
  id: z.string(),
})

// Response schema
export const GetLabelResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.any(),
  taskId: z.string().nullable(),
  workspaceId: z.string().nullable(),
})

export type GetLabelPathParams = z.infer<typeof GetLabelPathParamsSchema>
export type GetLabelResponse = z.infer<typeof GetLabelResponseSchema>
