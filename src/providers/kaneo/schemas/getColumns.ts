import { z } from 'zod'

// Path parameters schema
export const GetColumnsPathParamsSchema = z.object({
  projectId: z.string(),
})

// Response schema (empty per API spec)
export const GetColumnsResponseSchema = z.object({})

export type GetColumnsPathParams = z.infer<typeof GetColumnsPathParamsSchema>
export type GetColumnsResponse = z.infer<typeof GetColumnsResponseSchema>
