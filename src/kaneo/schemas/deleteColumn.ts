import { z } from 'zod'

// Path parameters schema
export const DeleteColumnPathParamsSchema = z.object({
  id: z.string(),
})

// Response schema (empty per API spec)
export const DeleteColumnResponseSchema = z.object({})

export type DeleteColumnPathParams = z.infer<typeof DeleteColumnPathParamsSchema>
export type DeleteColumnResponse = z.infer<typeof DeleteColumnResponseSchema>
