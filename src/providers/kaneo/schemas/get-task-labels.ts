import { z } from 'zod'

// Path parameters
export const GetTaskLabelsPathParamsSchema = z.object({
  taskId: z.string(),
})

// Label item schema
const LabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.any(),
  taskId: z.string().nullable(),
  workspaceId: z.string().nullable(),
})

// Response schema (array of labels)
export const GetTaskLabelsResponseSchema = z.array(LabelSchema)

export type GetTaskLabelsPathParams = z.infer<typeof GetTaskLabelsPathParamsSchema>
export type GetTaskLabelsResponse = z.infer<typeof GetTaskLabelsResponseSchema>
