import { z } from 'zod'

// Base column schema representing actual API response
export const ColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isFinal: z.boolean(),
})

export type Column = z.infer<typeof ColumnSchema>
