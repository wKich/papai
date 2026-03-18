// src/providers/youtrack/schemas/user.ts
import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'

export const UserSchema = BaseEntitySchema.extend({
  login: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
  created: TimestampSchema.optional(),
  lastAccess: TimestampSchema.optional(),
})

export const UserReferenceSchema = BaseEntitySchema.extend({
  login: z.string(),
})

export type User = z.infer<typeof UserSchema>
export type UserReference = z.infer<typeof UserReferenceSchema>
