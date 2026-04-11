import type { ReplyFn } from '../chat/types.js'
import { logger } from '../logger.js'
import { QueueRegistry } from './registry.js'
import type { CoalescedItem, QueueItem } from './types.js'

const log = logger.child({ scope: 'message-queue' })

// Singleton registry instance
const registry = new QueueRegistry()

// Export types for consumers
export type { QueueItem, CoalescedItem }
export type { ReplyFn } from '../chat/types.js'

// Export registry for testing
export { registry }

// Store handlers separately for shutdown flush
const handlers = new Map<string, (coalesced: CoalescedItem) => Promise<void>>()

/**
 * Enqueue a message for processing.
 * Fire-and-forget: resolves immediately after buffering.
 *
 * @param item - The message to enqueue
 * @param reply - Reply function for sending responses
 * @param handler - Callback to process the coalesced message
 */
export function enqueueMessage(
  item: QueueItem,
  reply: ReplyFn,
  handler: (coalesced: CoalescedItem) => Promise<void>,
): void {
  log.debug(
    {
      userId: item.userId,
      storageContextId: item.storageContextId,
      contextType: item.contextType,
    },
    'Enqueuing message',
  )

  // Store handler for this context
  handlers.set(item.storageContextId, handler)

  const queue = registry.getOrCreate(item.storageContextId)
  queue.setHandler(handler)
  queue.enqueue(item, reply)
}

/**
 * Flush all active queues on shutdown.
 * Called during graceful shutdown to process pending messages.
 *
 * @param options - Configuration options
 * @param options.timeoutMs - Maximum time to wait (default: 5000ms)
 */
export async function flushOnShutdown(options: { timeoutMs?: number } = {}): Promise<void> {
  const timeout = options.timeoutMs ?? 5000
  const startTime = Date.now()

  log.info('Starting graceful shutdown flush')

  const queues = registry.getAllQueues()
  const flushPromises: Promise<void>[] = []

  for (const [storageContextId, queue] of queues) {
    const coalesced = queue.forceFlush()
    if (coalesced !== null) {
      log.debug({ storageContextId, textLength: coalesced.text.length }, 'Flushing queue')
      const handler = handlers.get(storageContextId)
      if (handler !== undefined) {
        flushPromises.push(
          handler(coalesced).catch((error: unknown) => {
            log.error(
              { storageContextId, error: error instanceof Error ? error.message : String(error) },
              'Error during shutdown flush',
            )
          }),
        )
      }
    }

    if (Date.now() - startTime > timeout) {
      log.warn('Shutdown flush timeout reached, some messages may be lost')
      break
    }
  }

  // Wait for all flushes to complete (or timeout)
  await Promise.all(flushPromises)

  log.info({ queueCount: queues.size }, 'Shutdown flush complete')
}
