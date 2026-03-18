import { z } from 'zod'

// Response schema
export const GetConfigResponseSchema = z.object({
  disableRegistration: z.boolean().nullable(),
  isDemoMode: z.boolean(),
  hasSmtp: z.boolean(),
  hasGithubSignIn: z.boolean().nullable(),
  hasGoogleSignIn: z.boolean().nullable(),
  hasDiscordSignIn: z.boolean().nullable(),
  hasCustomOAuth: z.boolean().nullable(),
  hasGuestAccess: z.boolean().nullable(),
})

export type GetConfigResponse = z.infer<typeof GetConfigResponseSchema>
