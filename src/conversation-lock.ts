import { logger } from './logger.js'

const log = logger.child({ scope: 'conversation-lock' })

/** Maximum time a lock can be held before auto-release (ms). */
const LOCK_TIMEOUT_MS = 60_000

type QueueEntry = {
  resolve: () => void
}

const locks = new Map<string, { queue: QueueEntry[]; held: boolean; timer: ReturnType<typeof setTimeout> | null }>()

function getOrCreateLock(userId: string): {
  queue: QueueEntry[]
  held: boolean
  timer: ReturnType<typeof setTimeout> | null
} {
  let lock = locks.get(userId)
  if (lock === undefined) {
    lock = { queue: [], held: false, timer: null }
    locks.set(userId, lock)
  }
  return lock
}

function releaseLock(userId: string): void {
  const lock = locks.get(userId)
  if (lock === undefined) return

  if (lock.timer !== null) {
    clearTimeout(lock.timer)
    lock.timer = null
  }

  const next = lock.queue.shift()
  if (next === undefined) {
    lock.held = false
    locks.delete(userId)
    log.debug({ userId }, 'Lock released, no waiters')
  } else {
    log.debug({ userId, queueLength: lock.queue.length }, 'Lock handed to next waiter')
    lock.timer = setTimeout(() => {
      log.warn({ userId }, 'Conversation lock auto-released after timeout')
      releaseLock(userId)
    }, LOCK_TIMEOUT_MS)
    next.resolve()
  }
}

/**
 * Acquire an exclusive lock on a user's conversation.
 * Returns a release function that MUST be called when done.
 *
 * If the lock is already held, the caller waits in a FIFO queue.
 * A safety timeout auto-releases the lock after 60 seconds.
 */
export async function acquireConversationLock(userId: string): Promise<() => void> {
  const lock = getOrCreateLock(userId)

  if (!lock.held) {
    lock.held = true
    log.debug({ userId }, 'Lock acquired immediately')
    lock.timer = setTimeout(() => {
      log.warn({ userId }, 'Conversation lock auto-released after timeout')
      releaseLock(userId)
    }, LOCK_TIMEOUT_MS)
    return (): void => {
      releaseLock(userId)
    }
  }

  log.debug({ userId, queueLength: lock.queue.length + 1 }, 'Waiting for conversation lock')
  await new Promise<void>((resolve) => {
    lock.queue.push({ resolve })
  })
  return (): void => {
    releaseLock(userId)
  }
}

/**
 * Exported for testing: get the current lock timeout value.
 * @internal
 */
export const _LOCK_TIMEOUT_MS = LOCK_TIMEOUT_MS

/**
 * Exported for testing: clear all locks.
 * @internal
 */
export function _clearAllLocks(): void {
  for (const [, lock] of locks) {
    if (lock.timer !== null) clearTimeout(lock.timer)
  }
  locks.clear()
}
