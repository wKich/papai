import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'

export const YouTrackAttachmentSchema = BaseEntitySchema.extend({
  name: z.string(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
  url: z.string().optional(),
  thumbnailURL: z.string().optional(),
  author: z
    .object({
      login: z.string().optional(),
    })
    .optional(),
  created: TimestampSchema.optional(),
})
