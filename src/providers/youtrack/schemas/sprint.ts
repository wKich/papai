import { z } from 'zod'

export const SprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  archived: z.boolean().optional().default(false),
  goal: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  start: z.number().nullable().optional(),
  finish: z.number().nullable().optional(),
  unresolvedIssuesCount: z.number().optional(),
})

export type YouTrackSprint = z.infer<typeof SprintSchema>
