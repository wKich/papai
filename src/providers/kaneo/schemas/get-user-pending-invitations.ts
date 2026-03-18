import { z } from 'zod'

export const UserPendingInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  inviterName: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  status: z.string(),
})

export const GetUserPendingInvitationsResponseSchema = z.array(UserPendingInvitationSchema)

export type UserPendingInvitation = z.infer<typeof UserPendingInvitationSchema>
export type GetUserPendingInvitationsResponse = z.infer<typeof GetUserPendingInvitationsResponseSchema>
