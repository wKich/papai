import type { IncomingFile, ReplyFn } from '../chat/types.js'

export interface QueueItem {
  readonly text: string
  readonly userId: string
  readonly username: string | null
  readonly storageContextId: string
  readonly contextType: 'dm' | 'group'
  readonly files: readonly IncomingFile[]
}

export interface CoalescedItem {
  readonly text: string
  readonly userId: string
  readonly username: string | null
  readonly storageContextId: string
  readonly files: readonly IncomingFile[]
  readonly reply: ReplyFn
}

export interface QueueState {
  readonly items: readonly QueueItem[]
  readonly processing: boolean
  readonly timer: ReturnType<typeof setTimeout> | null
  readonly lastUserId: string | null
  readonly files: readonly IncomingFile[]
}

export interface InternalQueueState extends QueueState {
  readonly replies: readonly ReplyFn[]
}
