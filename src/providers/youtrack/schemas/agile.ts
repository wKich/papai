import { z } from 'zod'

export const AgileSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const AgileWithSprintsSchema = z.object({
  id: z.string(),
  sprints: z.array(z.object({ id: z.string() })).optional(),
})

export type YouTrackAgile = z.infer<typeof AgileSchema>
export type YouTrackAgileWithSprints = z.infer<typeof AgileWithSprintsSchema>
