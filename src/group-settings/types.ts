export type KnownGroupContext = {
  readonly contextId: string
  readonly provider: string
  readonly displayName: string
  readonly parentName: string | null
  readonly firstSeenAt: string
  readonly lastSeenAt: string
}

export type GroupAdminObservation = {
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly isAdmin: boolean
  readonly lastSeenAt: string
}

export type GroupSettingsCommand = 'config' | 'setup'
