import type { ButtonReplyOptions, ReplyFn, ReplyOptions } from '../types.js'

interface MattermostReplyHelpersParams {
  channelId: string
  postId?: string
  threadId?: string
  baseUrl: string
  getWsSeq: () => number
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>
  wsSend: (message: { seq: number; action: string; data: Record<string, unknown> }) => void
  uploadFile: (channelId: string, content: Buffer | string, filename: string) => Promise<string>
}

export function createMattermostReplyFn(params: MattermostReplyHelpersParams): ReplyFn {
  const { channelId, postId, threadId, baseUrl, getWsSeq, apiFetch, wsSend, uploadFile } = params

  const post = async (message: string, options?: ReplyOptions, extra?: Record<string, unknown>): Promise<void> => {
    await apiFetch('POST', '/api/v4/posts', {
      channel_id: channelId,
      message,
      root_id: options?.threadId ?? threadId ?? '',
      ...extra,
    })
  }

  return {
    text: (content: string, options?: ReplyOptions) => post(content, options),
    formatted: (markdown: string, options?: ReplyOptions) => post(markdown, options),
    file: async (file, options?: ReplyOptions) => {
      const fileId = await uploadFile(channelId, file.content, file.filename)
      await post('', options, { file_ids: [fileId] })
    },
    typing: () => {
      wsSend({ seq: getWsSeq(), action: 'user_typing', data: { channel_id: channelId } })
    },
    redactMessage: async (replacementText: string) => {
      if (postId !== undefined) {
        await apiFetch('PUT', `/api/v4/posts/${postId}/patch`, { message: replacementText }).catch(() => undefined)
      }
    },
    buttons: async (content: string, options: ButtonReplyOptions) => {
      const actions =
        options.buttons?.map((btn) => ({
          name: btn.text,
          integration: {
            url: `${baseUrl}/api/v4/actions/placeholder`,
            context: { action: btn.callbackData },
          },
          style: btn.style ?? 'default',
        })) ?? []

      const props = { attachments: [{ text: content, actions }] }
      await post(content, options, { props })
    },
  }
}
