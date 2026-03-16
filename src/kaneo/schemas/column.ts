import { z } from 'zod'

// Base column schema representing actual API response
export const ColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isFinal: z.boolean(),
})

// Column with position for reordering
export const ColumnWithPositionSchema = ColumnSchema.extend({
  position: z.number(),
})

export type Column = z.infer<typeof ColumnSchema>
export type ColumnWithPosition = z.infer<typeof ColumnWithPositionSchema>
