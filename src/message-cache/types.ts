export interface CachedMessage {
  messageId: string
  contextId: string
  authorId?: string
  authorUsername?: string
  text?: string
  replyToMessageId?: string
  timestamp: number
}
