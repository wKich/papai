import type { ContextType, IncomingFile, ReplyFn } from '../chat/types.js'

type QueueContextInfo = Readonly<{
  contextType: ContextType
}>

type QueueConfigContextInfo = Partial<
  Readonly<{
    configContextId: string | undefined
  }>
>

export type QueueItem = Readonly<{
  text: string
  userId: string
  username: string | null
  storageContextId: string
  files: readonly IncomingFile[]
}> &
  QueueContextInfo &
  QueueConfigContextInfo

export type CoalescedItem = Readonly<{
  text: string
  userId: string
  username: string | null
  storageContextId: string
  files: readonly IncomingFile[]
  reply: ReplyFn
}> &
  QueueContextInfo &
  QueueConfigContextInfo
