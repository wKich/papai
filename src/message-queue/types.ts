import type { IncomingFile, ReplyFn } from '../chat/types.js'

export interface QueueItem {
  text: string
  userId: string
  username: string | null
  storageContextId: string
  contextType: 'dm' | 'group'
  files: IncomingFile[]
}

export interface CoalescedItem {
  text: string
  userId: string
  username: string | null
  storageContextId: string
  files: IncomingFile[]
  reply: ReplyFn
}

export interface QueueState {
  items: QueueItem[]
  processing: boolean
  timer: ReturnType<typeof setTimeout> | null
  lastUserId: string | null
  files: IncomingFile[]
}

export interface InternalQueueState extends QueueState {
  replies: ReplyFn[]
}
