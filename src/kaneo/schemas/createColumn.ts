import { z } from 'zod'

// Path parameters schema
export const CreateColumnPathParamsSchema = z.object({
  projectId: z.string(),
})

// Request schema
export const CreateColumnRequestSchema = z.object({
  name: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  isFinal: z.boolean().optional(),
})

// Response schema (empty per API spec)
export const CreateColumnResponseSchema = z.object({})

export type CreateColumnPathParams = z.infer<typeof CreateColumnPathParamsSchema>
export type CreateColumnRequest = z.infer<typeof CreateColumnRequestSchema>
export type CreateColumnResponse = z.infer<typeof CreateColumnResponseSchema>
