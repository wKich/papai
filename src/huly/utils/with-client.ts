import { logger } from '../../logger.js'
import { classifyHulyError } from '../classify-error.js'
import type { getHulyClient } from '../huly-client.js'
import type { HulyClient } from '../types.js'

const log = logger.child({ scope: 'huly:with-client' })

/**
 * Higher-order function that manages Huly client lifecycle
 * - Gets client for user
 * - Executes operation
 * - Ensures client is closed in finally block
 * - Catches and classifies errors
 */
export async function withClient<T>(
  userId: number,
  getClient: typeof getHulyClient,
  operation: (client: HulyClient) => Promise<T>,
): Promise<T> {
  const client = await getClient(userId)

  try {
    return await operation(client)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId }, 'Operation failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
