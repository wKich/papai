// Mattermost typing indicator expires after ~5 seconds (TimeBetweenUserTypingUpdatesMilliseconds)
const TYPING_INTERVAL_MS = 4500

type MattermostWsSend = (message: { seq: number; action: string; data: Record<string, unknown> }) => void

/**
 * Run `fn` while periodically triggering the Mattermost typing indicator via
 * WebSocket `user_typing` events. Errors from typing are swallowed; errors from
 * `fn` are re-thrown.
 */
export async function withTypingIndicator<T>(
  channelId: string,
  getWsSeq: () => number,
  wsSend: MattermostWsSend,
  fn: () => Promise<T>,
): Promise<T> {
  const send = (): void => {
    try {
      wsSend({ seq: getWsSeq(), action: 'user_typing', data: { channel_id: channelId } })
    } catch {
      // Swallow errors from typing indicator
    }
  }
  send()
  const interval = setInterval(send, TYPING_INTERVAL_MS)
  try {
    return await fn()
  } finally {
    clearInterval(interval)
  }
}
