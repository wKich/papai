import { z } from 'zod'

export const SavedQuerySchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string().nullable().optional(),
})

export type YouTrackSavedQuery = z.infer<typeof SavedQuerySchema>
