import type { IncomingInteraction } from '../types.js'

export type TelegramInteractionContext = {
  from?: { id?: number; username?: string }
  chat?: { id?: number; type?: string }
  callbackQuery?: { data?: string; message?: { message_id?: number; message_thread_id?: number } }
}

function callbackMessageId(ctx: TelegramInteractionContext): string | undefined {
  const messageId = ctx.callbackQuery?.message?.message_id
  return messageId === undefined ? undefined : String(messageId)
}

function callbackThreadId(ctx: TelegramInteractionContext): string | undefined {
  const threadId = ctx.callbackQuery?.message?.message_thread_id
  return threadId === undefined ? undefined : String(threadId)
}

export function buildTelegramInteraction(
  ctx: TelegramInteractionContext,
  isAdmin: boolean,
): IncomingInteraction | null {
  const callbackData = ctx.callbackQuery?.data ?? ''
  if (callbackData === '') return null

  const userId = String(ctx.from?.id ?? '')
  return {
    kind: 'button',
    user: { id: userId, username: ctx.from?.username ?? null, isAdmin },
    contextId: String(ctx.chat?.id ?? userId),
    contextType: ctx.chat?.type === 'private' ? 'dm' : 'group',
    callbackData,
    messageId: callbackMessageId(ctx),
    threadId: callbackThreadId(ctx),
  }
}
