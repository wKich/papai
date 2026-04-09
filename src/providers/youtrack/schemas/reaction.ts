import { z } from 'zod'

import { BaseEntitySchema } from './common.js'
import { UserSchema } from './user.js'

export const ReactionSchema = BaseEntitySchema.extend({
  author: UserSchema,
  reaction: z.string(),
})
