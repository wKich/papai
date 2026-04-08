// src/providers/youtrack/schemas/bundle.ts
import { z } from 'zod'

export const StateValueSchema = z.object({
  id: z.string(),
  name: z.string(),
  ordinal: z.number().optional(),
  isResolved: z.boolean().optional(),
})

export const StateBundleSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  aggregated: z
    .object({
      project: z.array(z.object({ id: z.string() })).optional(),
    })
    .optional(),
})

export const ProjectCustomFieldSchema = z.object({
  $type: z.string(),
  field: z
    .object({
      name: z.string(),
      localizedName: z.string().optional(),
    })
    .optional(),
  bundle: z
    .object({
      id: z.string(),
      $type: z.string().optional(),
    })
    .optional(),
})

export type StateValue = z.infer<typeof StateValueSchema>
export type StateBundle = z.infer<typeof StateBundleSchema>
export type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>
