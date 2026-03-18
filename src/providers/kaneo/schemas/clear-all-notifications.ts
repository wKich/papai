import { z } from 'zod'

// Response schema
export const ClearAllNotificationsResponseSchema = z.object({
  success: z.boolean(),
  count: z.number().optional(),
})

export type ClearAllNotificationsResponse = z.infer<typeof ClearAllNotificationsResponseSchema>
