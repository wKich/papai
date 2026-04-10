import type { Context } from 'grammy'

import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:telegram' })

/** Shape of getChat response for forum checks */
interface ChatInfo {
  is_forum?: boolean
}

/**
 * Creates a new forum topic when bot is mentioned in main chat of a forum group.
 * Returns threadId if topic created or already in thread, undefined otherwise.
 */
export async function createForumTopicIfNeeded(
  ctx: Context,
  api: { getChat: (chatId: number) => Promise<unknown>; createForumTopic: (chatId: number, name: string) => Promise<{ message_thread_id: number }> },
): Promise<string | undefined> {
  // Already in a thread/topic
  const existingThreadId = ctx.message?.message_thread_id
  if (existingThreadId !== undefined) {
    return String(existingThreadId)
  }

  const chat = ctx.chat
  if (chat?.type !== 'supergroup') return undefined

  // Check if chat is a forum
  const chatInfo = await api.getChat(chat.id) as ChatInfo
  const isForum = chatInfo.is_forum === true
  if (!isForum) return undefined

  try {
    const username = ctx.from?.username ?? 'user'
    const topic = await api.createForumTopic(chat.id, `Question from @${username}`)
    log.info({ threadId: topic.message_thread_id, chatId: chat.id }, 'Created forum topic')
    return String(topic.message_thread_id)
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error), chatId: chat.id }, 'Failed to create forum topic')
    return undefined
  }
}
