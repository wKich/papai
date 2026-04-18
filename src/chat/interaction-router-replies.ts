import type { ReplyFn } from './types.js'

export async function replyTextPreferReplace(reply: ReplyFn, content: string): Promise<void> {
  if ('replaceText' in reply && typeof reply.replaceText === 'function') {
    await reply.replaceText(content)
    return
  }

  await reply.text(content)
}

export async function replyButtonsPreferReplace(
  reply: ReplyFn,
  content: string,
  buttons: Parameters<ReplyFn['buttons']>[1]['buttons'],
): Promise<void> {
  if ('replaceButtons' in reply && typeof reply.replaceButtons === 'function') {
    await reply.replaceButtons(content, { buttons })
    return
  }

  await reply.buttons(content, { buttons })
}
