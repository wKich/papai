import type { ChatFile, ReplyFn, ReplyOptions } from './chat/types.js'
import { createScheduler } from './utils/scheduler.js'

const TYPING_INTERVAL_MS = 4500
const TYPING_HEARTBEAT_TASK = 'reply-typing-heartbeat'

type TextLikeReply = {
  (content: string): Promise<void>
  (content: string, options: ReplyOptions): Promise<void>
}
type FileLikeReply = {
  (file: ChatFile): Promise<void>
  (file: ChatFile, options: ReplyOptions): Promise<void>
}
type TypingHeartbeatOptions = { intervalMs: number | undefined }

function wrapReplyWithHeartbeatStop(reply: ReplyFn, stop: () => void): ReplyFn {
  const withStop =
    <Args extends readonly unknown[]>(fn: (...args: Args) => Promise<void>) =>
    (...args: Args): Promise<void> => {
      stop()
      return fn(...args)
    }
  const wrapTextReply =
    (fn: TextLikeReply): TextLikeReply =>
    (...args: [content: string] | [content: string, options: ReplyOptions]): Promise<void> => {
      const [content, options] = args
      stop()
      return options === undefined ? fn(content) : fn(content, options)
    }
  const wrapFileReply =
    (fn: FileLikeReply): FileLikeReply =>
    (...args: [file: ChatFile] | [file: ChatFile, options: ReplyOptions]): Promise<void> => {
      const [file, options] = args
      stop()
      return options === undefined ? fn(file) : fn(file, options)
    }

  return {
    ...reply,
    text: wrapTextReply(reply.text),
    formatted: wrapTextReply(reply.formatted),
    buttons: withStop(reply.buttons),
    ...(reply.replaceText === undefined ? {} : { replaceText: wrapTextReply(reply.replaceText) }),
    ...(reply.file === undefined ? {} : { file: wrapFileReply(reply.file) }),
    ...(reply.redactMessage === undefined ? {} : { redactMessage: withStop(reply.redactMessage) }),
    ...(reply.replaceButtons === undefined ? {} : { replaceButtons: withStop(reply.replaceButtons) }),
    ...(reply.embed === undefined ? {} : { embed: withStop(reply.embed) }),
  }
}

export async function withReplyTypingHeartbeat<T>(
  reply: ReplyFn,
  fn: (wrappedReply: ReplyFn) => Promise<T>,
  ...rest: [] | [options: TypingHeartbeatOptions]
): Promise<T> {
  let intervalMs = TYPING_INTERVAL_MS
  const options = rest[0]
  if (options !== undefined && options.intervalMs !== undefined) {
    intervalMs = options.intervalMs
  }
  const scheduler = createScheduler()
  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    scheduler.stop(TYPING_HEARTBEAT_TASK)
    scheduler.unregister(TYPING_HEARTBEAT_TASK)
  }

  scheduler.register(TYPING_HEARTBEAT_TASK, {
    interval: intervalMs,
    handler: (): void => {
      if (stopped) return
      reply.typing()
    },
  })
  scheduler.start(TYPING_HEARTBEAT_TASK)
  reply.typing()

  try {
    return await fn(wrapReplyWithHeartbeatStop(reply, stop))
  } finally {
    stop()
  }
}
