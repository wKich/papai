import { z } from 'zod'

export const CreateLabelResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.unknown().optional(),
  taskId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
})

export type CreateLabelResponse = z.infer<typeof CreateLabelResponseSchema>
