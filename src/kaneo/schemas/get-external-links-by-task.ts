import { z } from 'zod'

// Path parameters schema
export const GetExternalLinksByTaskPathParamsSchema = z.object({
  taskId: z.string(),
})

// External link item schema
export const ExternalLinkItemSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  integrationId: z.string(),
  resourceType: z.string(),
  externalId: z.string(),
  url: z.string(),
  title: z.string().nullable(),
  metadata: z.object({}),
  createdAt: z.object({}),
  updatedAt: z.object({}),
})

// Response schema (array of external links)
export const GetExternalLinksByTaskResponseSchema = z.array(ExternalLinkItemSchema)

export type GetExternalLinksByTaskPathParams = z.infer<typeof GetExternalLinksByTaskPathParamsSchema>
export type ExternalLinkItem = z.infer<typeof ExternalLinkItemSchema>
export type GetExternalLinksByTaskResponse = z.infer<typeof GetExternalLinksByTaskResponseSchema>
