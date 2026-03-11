import type { LinearIssue, LinearLabel, LinearProject, LinearState } from './scripts/linear-client.js'

export type MigrationStats = {
  labels: number
  projects: number
  columns: number
  tasks: number
  comments: number
  relations: number
  archived: number
}

export type MigrationUserResult = {
  userId: number
  username: string | null
  status: string
  stats?: MigrationStats
  kaneoEmail?: string
  kaneoPassword?: string
}

export type MigrationOptions = {
  dryRun?: boolean
  clearHistory?: boolean
  singleUserId?: number
  kaneoUrl?: string
}

export type ProgressCallback = (msg: string) => Promise<void>

export type LinearData = {
  labels: LinearLabel[]
  states: LinearState[]
  projects: LinearProject[]
  issues: LinearIssue[]
}

export type UserRow = { telegram_id: number; username: string | null }
export type ConfigRow = { key: string; value: string }
export type ResolvedKaneoConfig = {
  kaneoKey: string
  kaneoBaseUrl: string
  kaneoWorkspaceId: string
  kaneoEmail?: string
  kaneoPassword?: string
}
