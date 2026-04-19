type ContextType = 'dm' | 'group'

export type DeferredAudience = 'personal' | 'shared'

export type DeferredDeliveryTarget = {
  contextId: string
  contextType: ContextType
  threadId: string | null
  audience: DeferredAudience
  mentionUserIds: string[]
  createdByUserId: string
  createdByUsername: string | null
}

export function dmTarget(userId: string): DeferredDeliveryTarget {
  return {
    contextId: userId,
    contextType: 'dm',
    threadId: null,
    audience: 'personal',
    mentionUserIds: [],
    createdByUserId: userId,
    createdByUsername: null,
  }
}
