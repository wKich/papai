import { z } from 'zod'

export const ActivitySchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  author: z
    .object({
      id: z.string(),
      login: z.string().optional(),
      name: z.string().optional(),
      fullName: z.string().optional(),
    })
    .optional(),
  category: z.object({ id: z.string() }).optional(),
  field: z.object({ name: z.string() }).optional(),
  targetMember: z.string().optional(),
  added: z.unknown().optional(),
  removed: z.unknown().optional(),
})

export type YouTrackActivity = z.infer<typeof ActivitySchema>
