import { z } from 'zod'

export const GetInvitationDetailsPathParamsSchema = z.object({
  id: z.string(),
})

export const InvitationDetailsSchema = z.object({
  id: z.string(),
  email: z.string(),
  workspaceName: z.string(),
  inviterName: z.string(),
  expiresAt: z.string(),
  status: z.string(),
  expired: z.boolean(),
})

export const GetInvitationDetailsResponseSchema = z.object({
  valid: z.boolean(),
  invitation: InvitationDetailsSchema.optional(),
  error: z.string().optional(),
})

export type GetInvitationDetailsPathParams = z.infer<typeof GetInvitationDetailsPathParamsSchema>
export type InvitationDetails = z.infer<typeof InvitationDetailsSchema>
export type GetInvitationDetailsResponse = z.infer<typeof GetInvitationDetailsResponseSchema>
