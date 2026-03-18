import { z } from 'zod'

// Path parameters schema
export const ReorderColumnsPathParamsSchema = z.object({
  projectId: z.string(),
})

// Column order item schema
export const ColumnOrderItemSchema = z.object({
  id: z.string(),
  position: z.number(),
})

// Request schema
export const ReorderColumnsRequestSchema = z.object({
  columns: z.array(ColumnOrderItemSchema),
})

// Response schema (empty per API spec)
export const ReorderColumnsResponseSchema = z.object({})

export type ReorderColumnsPathParams = z.infer<typeof ReorderColumnsPathParamsSchema>
export type ColumnOrderItem = z.infer<typeof ColumnOrderItemSchema>
export type ReorderColumnsRequest = z.infer<typeof ReorderColumnsRequestSchema>
export type ReorderColumnsResponse = z.infer<typeof ReorderColumnsResponseSchema>
