import { z } from 'zod'

// Path parameters schema
export const UpdateColumnPathParamsSchema = z.object({
  id: z.string(),
})

// Request schema
export const UpdateColumnRequestSchema = z.object({
  name: z.string().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  isFinal: z.boolean().optional(),
})

// Response schema (empty per API spec)
export const UpdateColumnResponseSchema = z.object({})

export type UpdateColumnPathParams = z.infer<typeof UpdateColumnPathParamsSchema>
export type UpdateColumnRequest = z.infer<typeof UpdateColumnRequestSchema>
export type UpdateColumnResponse = z.infer<typeof UpdateColumnResponseSchema>
