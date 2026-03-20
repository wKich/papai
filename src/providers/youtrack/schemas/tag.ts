// src/providers/youtrack/schemas/tag.ts
import { z } from 'zod'

import { BaseEntitySchema } from './common.js'

const FieldStyleSchema = z.object({
  $type: z.string().optional(),
  id: z.string().optional(),
  background: z.string(),
  foreground: z.string().optional(),
})

export const TagSchema = BaseEntitySchema.extend({
  name: z.string(),
  color: FieldStyleSchema.nullable().optional(),
  untagOnResolve: z.boolean().optional(),
  owner: z.object({ id: z.string() }).optional(),
})
