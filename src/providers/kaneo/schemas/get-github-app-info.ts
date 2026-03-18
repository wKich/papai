import { z } from 'zod'

export const GetGitHubAppInfoResponseSchema = z.object({
  appName: z.string().nullable(),
})

export type GetGitHubAppInfoResponse = z.infer<typeof GetGitHubAppInfoResponseSchema>
