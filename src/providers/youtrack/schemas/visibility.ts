import { z } from 'zod'

import { BaseEntitySchema } from './common.js'

export const VisibilityUserSchema = BaseEntitySchema.extend({
  login: z.string().optional(),
  fullName: z.string().optional(),
})

export const VisibilityGroupSchema = BaseEntitySchema.extend({
  name: z.string(),
})

export const UnlimitedVisibilitySchema = z.object({
  $type: z.literal('UnlimitedVisibility'),
})

export const LimitedVisibilitySchema = z.object({
  $type: z.literal('LimitedVisibility'),
  permittedUsers: z.array(VisibilityUserSchema).optional(),
  permittedGroups: z.array(VisibilityGroupSchema).optional(),
})

export const VisibilitySchema = z.discriminatedUnion('$type', [UnlimitedVisibilitySchema, LimitedVisibilitySchema])
