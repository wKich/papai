import { z } from 'zod'

export const CreateLabelRequestSchema = z.object({
  name: z.string(),
  color: z.string(),
  workspaceId: z.string(),
  taskId: z.string().optional(),
})

export const CreateLabelResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.unknown().optional(),
  taskId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
})

export type CreateLabelRequest = z.infer<typeof CreateLabelRequestSchema>
export type CreateLabelResponse = z.infer<typeof CreateLabelResponseSchema>
