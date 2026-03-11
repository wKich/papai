/**
 * Sequential processing queue for async operations.
 *
 * Processes items one at a time to respect rate limits and avoid
 * overwhelming external APIs, while satisfying no-await-in-loop lint rule.
 */

export interface QueueItem<T, R> {
  item: T
  processor: (item: T) => Promise<R>
}

export interface QueueOptions {
  /** Delay between operations in ms (for rate limiting) */
  delayMs?: number
}

/**
 * Process items sequentially using recursion instead of loops with await.
 * This satisfies the no-await-in-loop lint rule while maintaining sequential execution.
 */
export async function processSequentially<T, R>(
  items: readonly T[],
  processor: (item: T) => Promise<R>,
  options: QueueOptions = {},
): Promise<R[]> {
  const results: R[] = []

  async function processNext(index: number): Promise<void> {
    if (index >= items.length) return

    const item = items[index]
    if (item === undefined) return

    const result = await processor(item)
    results.push(result)

    if (options.delayMs !== undefined && options.delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve()
        }, options.delayMs)
      })
    }

    return processNext(index + 1)
  }

  await processNext(0)
  return results
}

/**
 * Process items sequentially with accumulator pattern.
 * Useful when each iteration updates shared state.
 */
export function processWithAccumulator<T, A>(
  items: readonly T[],
  initialAccumulator: A,
  processor: (item: T, accumulator: A) => Promise<A>,
  options: QueueOptions = {},
): Promise<A> {
  async function processNext(index: number, accumulator: A): Promise<A> {
    if (index >= items.length) return accumulator

    const item = items[index]
    if (item === undefined) return accumulator

    const newAccumulator = await processor(item, accumulator)

    if (options.delayMs !== undefined && options.delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve()
        }, options.delayMs)
      })
    }

    return processNext(index + 1, newAccumulator)
  }

  return processNext(0, initialAccumulator)
}

/**
 * Process items sequentially and count successful operations.
 */
export function processAndCount<T>(
  items: readonly T[],
  processor: (item: T) => Promise<boolean>,
  options: QueueOptions = {},
): Promise<number> {
  async function processNext(index: number, count: number): Promise<number> {
    if (index >= items.length) return count

    const item = items[index]
    if (item === undefined) return count

    const success = await processor(item)
    const newCount = success ? count + 1 : count

    if (options.delayMs !== undefined && options.delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve()
        }, options.delayMs)
      })
    }

    return processNext(index + 1, newCount)
  }

  return processNext(0, 0)
}
