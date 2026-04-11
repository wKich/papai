import type { ReplyFn, IncomingFile } from '../chat/types.js'
import { logger } from '../logger.js'
import type { QueueItem, CoalescedItem } from './types.js'

const log = logger.child({ scope: 'message-queue' })

const DEBOUNCE_MS = 500

interface BufferedMessage {
  item: QueueItem
  reply: ReplyFn
}

export class MessageQueue {
  private readonly storageContextId: string
  private messages: BufferedMessage[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastUserId: string | null = null

  constructor(storageContextId: string) {
    this.storageContextId = storageContextId
    log.debug({ storageContextId }, 'MessageQueue created')
  }

  enqueue(item: QueueItem, reply: ReplyFn): CoalescedItem | null {
    reply.typing()

    const isGroupMain = item.contextType === 'group' && !this.storageContextId.includes('thread')
    const hasBufferedItems = this.messages.length > 0
    const isDifferentUser = this.lastUserId !== null && this.lastUserId !== item.userId

    if (isGroupMain && hasBufferedItems && isDifferentUser) {
      const flushed = this.forceFlush()
      this.messages.push({ item, reply })
      this.lastUserId = item.userId
      this.resetTimer()
      return flushed
    }

    this.messages.push({ item, reply })
    this.lastUserId = item.userId

    log.debug(
      {
        userId: item.userId,
        storageContextId: this.storageContextId,
        contextType: item.contextType,
        bufferedCount: this.messages.length,
      },
      'Message enqueued',
    )

    this.resetTimer()
    return null
  }

  getBufferedCount(): number {
    return this.messages.length
  }

  private resetTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      this.flush()
    }, DEBOUNCE_MS)
  }

  private flush(): CoalescedItem | null {
    if (this.messages.length === 0) {
      return null
    }

    const fileCount = this.messages.reduce((count, msg) => count + msg.item.files.length, 0)
    log.debug({ storageContextId: this.storageContextId, itemCount: this.messages.length, fileCount }, 'Flushing queue')

    const firstMessage = this.messages[0]
    if (firstMessage === undefined) {
      return null
    }

    const isThread = firstMessage.item.contextType === 'group' && this.storageContextId.includes('thread')
    const isDm = firstMessage.item.contextType === 'dm'

    const texts: string[] = []
    const allFiles: IncomingFile[] = []
    const lastMessage = this.messages[this.messages.length - 1]!
    const reply = lastMessage.reply

    for (const msg of this.messages) {
      if (isThread && msg.item.username !== null) {
        texts.push(`[@${msg.item.username}]: ${msg.item.text}`)
      } else {
        texts.push(msg.item.text)
      }
      allFiles.push(...msg.item.files)
    }

    const text = isDm ? texts.join('\n\n') : texts.join('\n')

    const result: CoalescedItem = {
      text,
      userId: firstMessage.item.userId,
      username: firstMessage.item.username,
      storageContextId: this.storageContextId,
      files: allFiles,
      reply,
    }

    this.messages = []
    this.timer = null
    this.lastUserId = null

    return result
  }

  forceFlush(): CoalescedItem | null {
    log.info({ storageContextId: this.storageContextId, itemCount: this.messages.length }, 'Force flush requested')

    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    return this.flush()
  }
}
