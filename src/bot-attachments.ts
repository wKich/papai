import { listActiveAttachments, persistIncomingAttachments } from './attachments/index.js'
import type { AttachmentRef, AttachmentSourceProvider } from './attachments/types.js'
import type { ChatProvider, IncomingFile, IncomingMessage } from './chat/types.js'

const SOURCE_BY_NAME: Readonly<Record<string, AttachmentSourceProvider>> = {
  telegram: 'telegram',
  mattermost: 'mattermost',
  discord: 'discord',
}

const toSourceProvider = (name: string): AttachmentSourceProvider => SOURCE_BY_NAME[name] ?? 'unknown'

export type IngestAttachmentsParams = {
  chat: ChatProvider
  msg: IncomingMessage
  storageContextId: string
  files: readonly IncomingFile[]
}

export type IngestAttachmentsResult = {
  newAttachmentIds: readonly string[]
  activeAttachments: readonly AttachmentRef[]
}

export async function ingestAttachmentsForMessage(params: IngestAttachmentsParams): Promise<IngestAttachmentsResult> {
  const persistParams: Parameters<typeof persistIncomingAttachments>[0] = {
    contextId: params.storageContextId,
    sourceProvider: toSourceProvider(params.chat.name),
    files: params.files,
  }
  if (params.msg.messageId !== undefined) persistParams.sourceMessageId = params.msg.messageId
  const newRefs = await persistIncomingAttachments(persistParams)
  const activeAttachments = listActiveAttachments(params.storageContextId)
  return {
    newAttachmentIds: newRefs.map((ref) => ref.attachmentId),
    activeAttachments,
  }
}
