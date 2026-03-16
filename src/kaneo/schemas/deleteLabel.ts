import { z } from 'zod'

export const DeleteLabelPathParamsSchema = z.object({
  id: z.string(),
})

export const DeleteLabelResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.unknown(),
  taskId: z.string().nullable(),
  workspaceId: z.string().nullable(),
})

export type DeleteLabelPathParams = z.infer<typeof DeleteLabelPathParamsSchema>
export type DeleteLabelResponse = z.infer<typeof DeleteLabelResponseSchema>
