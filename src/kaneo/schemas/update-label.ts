import { z } from 'zod'

// Path parameters
export const UpdateLabelPathParamsSchema = z.object({
  id: z.string(),
})

// Request body schema
export const UpdateLabelRequestSchema = z.object({
  name: z.string(),
  color: z.string(),
})

// Response schema
export const UpdateLabelResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.any(),
  taskId: z.string().nullable(),
  workspaceId: z.string().nullable(),
})

export type UpdateLabelPathParams = z.infer<typeof UpdateLabelPathParamsSchema>
export type UpdateLabelRequest = z.infer<typeof UpdateLabelRequestSchema>
export type UpdateLabelResponse = z.infer<typeof UpdateLabelResponseSchema>
