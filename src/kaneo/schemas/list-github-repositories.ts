import { z } from 'zod'

export const GitHubRepositoryOwnerSchema = z.object({
  login: z.string(),
})

export const GitHubRepositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  owner: GitHubRepositoryOwnerSchema,
  private: z.boolean(),
  html_url: z.string(),
})

export const ListGitHubRepositoriesResponseSchema = z.array(GitHubRepositorySchema)

export type GitHubRepositoryOwner = z.infer<typeof GitHubRepositoryOwnerSchema>
export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>
export type ListGitHubRepositoriesResponse = z.infer<typeof ListGitHubRepositoriesResponseSchema>
