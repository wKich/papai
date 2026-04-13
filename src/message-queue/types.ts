import type { ContextType, IncomingFile, ReplyFn } from '../chat/types.js'

export interface QueueItem {
  readonly text: string
  readonly userId: string
  readonly username: string | null
  readonly storageContextId: string
  readonly contextType: ContextType
  readonly files: readonly IncomingFile[]
}

export interface CoalescedItem {
  readonly text: string
  readonly userId: string
  readonly username: string | null
  readonly storageContextId: string
  readonly contextType: ContextType
  readonly files: readonly IncomingFile[]
  readonly reply: ReplyFn
}
