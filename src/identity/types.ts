/** Methods by which an identity mapping can be established */
export type MatchMethod = 'auto' | 'manual_nl' | 'unmatched'

/** Stored identity mapping linking chat user to task tracker user */
export interface IdentityMapping {
  contextId: string
  providerName: string
  providerUserId: string | null
  providerUserLogin: string | null
  displayName: string | null
  matchedAt: string
  matchMethod: MatchMethod | null
  confidence: number | null
}

/** Resolved user identity ready for use in tool calls */
export interface UserIdentity {
  userId: string
  login: string
  displayName: string
}

/** Result of identity resolution */
export type IdentityResolutionResult =
  | { type: 'found'; identity: UserIdentity }
  | { type: 'not_found'; message: string }
  | { type: 'unmatched'; message: string }
