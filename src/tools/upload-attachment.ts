import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getIncomingFiles } from '../file-relay.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:upload-attachment' })

export type UploadAttachmentStatus =
  | { status: 'no_files'; message: string }
  | { status: 'file_not_found'; message: string; availableFileIds: string[] }

async function executeUpload(
  provider: TaskProvider,
  contextId: string,
  taskId: string,
  fileId: string,
): Promise<unknown> {
  const files = getIncomingFiles(contextId)

  if (files.length === 0) {
    log.warn({ taskId, fileId }, 'upload_attachment: no files in relay')
    return {
      status: 'no_files',
      message: 'No files were found in the current message. Please send the file along with your request.',
    } satisfies UploadAttachmentStatus
  }

  const file = files.find((f) => f.fileId === fileId)

  if (file === undefined) {
    const availableFileIds = files.map((f) => f.fileId)
    log.warn({ taskId, fileId, availableFileIds }, 'upload_attachment: fileId not found in relay')
    return {
      status: 'file_not_found',
      message: `File "${fileId}" was not found among the attached files.`,
      availableFileIds,
    } satisfies UploadAttachmentStatus
  }

  const result = await provider.uploadAttachment!(taskId, {
    name: file.filename,
    content: file.content,
    mimeType: file.mimeType,
  })
  log.info({ taskId, attachmentId: result.id, filename: file.filename }, 'Attachment uploaded')
  return result
}

export function makeUploadAttachmentTool(provider: TaskProvider, contextId: string): ToolSet[string] {
  return tool({
    description: 'Upload a file attachment to a task. The file must have been sent by the user in the current message.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to attach the file to'),
      fileId: z.string().describe('The file ID from the incoming message to attach'),
    }),
    execute: async ({ taskId, fileId }) => {
      log.debug({ taskId, fileId, contextId }, 'upload_attachment called')
      try {
        return await executeUpload(provider, contextId, taskId, fileId)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, fileId, tool: 'upload_attachment' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
