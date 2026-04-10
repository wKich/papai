// Under Discord's ~10s typing expiry
const TYPING_INTERVAL_MS = 4500

type TypingChannel = {
  sendTyping: () => Promise<void>
}

/**
 * Run `fn` while periodically triggering the Discord typing indicator on
 * `channel`. Errors from `sendTyping` are swallowed; errors from `fn` are
 * re-thrown.
 */
export async function withTypingIndicator<T>(channel: TypingChannel, fn: () => Promise<T>): Promise<T> {
  const send = (): void => {
    channel.sendTyping().catch(() => undefined)
  }
  send()
  const interval = setInterval(send, TYPING_INTERVAL_MS)
  try {
    return await fn()
  } finally {
    clearInterval(interval)
  }
}
