import { z } from 'zod'

// Path parameters
export const GetWorkspaceLabelsPathParamsSchema = z.object({
  workspaceId: z.string(),
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
export const GetWorkspaceLabelsResponseSchema = z.array(LabelSchema)

export type GetWorkspaceLabelsPathParams = z.infer<typeof GetWorkspaceLabelsPathParamsSchema>
export type GetWorkspaceLabelsResponse = z.infer<typeof GetWorkspaceLabelsResponseSchema>
