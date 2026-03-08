import { logger } from '../../logger.js'
import { classifyHulyError } from '../classify-error.js'

const log = logger.child({ scope: 'huly:with-client' })

export interface CloseableClient {
  close(): Promise<void>
}

/**
 * Higher-order function that manages Huly client lifecycle
 * - Gets client for user
 * - Executes operation
 * - Ensures client is closed in finally block
 * - Catches and classifies errors
 */
export async function withClient<T, C extends CloseableClient>(
  userId: number,
  getClient: (userId: number) => Promise<C>,
  operation: (client: C) => Promise<T>,
  context?: Record<string, unknown>,
): Promise<T> {
  const client = await getClient(userId)

  try {
    return await operation(client)
  } catch (error) {
    log.error(
      { ...(context ?? {}), error: error instanceof Error ? error.message : String(error), userId },
      'Operation failed',
    )
    throw classifyHulyError(error)
  } finally {
    try {
      await client.close()
    } catch (closeError) {
      log.error(
        { ...(context ?? {}), error: closeError instanceof Error ? closeError.message : String(closeError), userId },
        'Failed to close Huly client',
      )
    }
  }
}
