// src/providers/youtrack/schemas/common.ts
import { z } from 'zod'

export const BaseEntitySchema = z.object({
  id: z.string(),
  $type: z.string().optional(),
})

export const TimestampSchema = z.number().int().positive()
