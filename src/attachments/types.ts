export type AttachmentStatus = 'available' | 'tool_only' | 'rejected' | 'unavailable'

export type AttachmentSourceProvider = 'telegram' | 'mattermost' | 'discord' | 'unknown'

export type AttachmentRef = {
  attachmentId: string
  contextId: string
  filename: string
  status: AttachmentStatus
} & Partial<{
  mimeType: string
  size: number
}>

export type StoredAttachment = AttachmentRef & {
  sourceProvider: AttachmentSourceProvider
  checksum: string
  blobKey: string
  createdAt: string
  content: Buffer
} & Partial<{
    sourceMessageId: string
    sourceFileId: string
    clearedAt: string | null
    lastUsedAt: string | null
  }>

export type SaveAttachmentInput = {
  contextId: string
  sourceProvider: AttachmentSourceProvider
  filename: string
  status: AttachmentStatus
  content: Buffer
} & Partial<{
  sourceMessageId: string
  sourceFileId: string
  mimeType: string
  size: number
}>
