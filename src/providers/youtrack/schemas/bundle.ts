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
  id: z.string().optional(),
  $type: z.string(),
  field: z
    .object({
      id: z.string().optional(),
      name: z.string(),
      localizedName: z.string().optional(),
      $type: z.string().optional(),
    })
    .optional(),
  canBeEmpty: z.boolean().optional(),
  emptyFieldText: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  bundle: z
    .object({
      id: z.string(),
      $type: z.string().optional(),
    })
    .optional(),
})
