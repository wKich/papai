import { z } from 'zod'

// Response schema
export const MarkAllNotificationsAsReadResponseSchema = z.object({
  success: z.boolean(),
  count: z.number().optional(),
})

export type MarkAllNotificationsAsReadResponse = z.infer<typeof MarkAllNotificationsAsReadResponseSchema>
