export interface CachedMessage {
  messageId: string
  contextId: string
  authorId?: string
  authorUsername?: string
  text?: string
  replyToMessageId?: string
  timestamp: number
}

export interface MessageMetadataRow {
  message_id: string
  context_id: string
  author_id: string | null
  author_username: string | null
  text: string | null
  reply_to_message_id: string | null
  timestamp: number
  expires_at: number
}
