/**
 * Sequential processing queue for async operations.
 *
 * Processes items one at a time to respect rate limits and avoid
 * overwhelming external APIs.
 */

interface QueueOptions {
  /** Delay between operations in ms (for rate limiting) */
  delayMs?: number
}

function makeDelay(options: QueueOptions): () => Promise<void> {
  return () =>
    options.delayMs !== undefined && options.delayMs > 0
      ? new Promise<void>((resolve) => {
          setTimeout(resolve, options.delayMs)
        })
      : Promise.resolve()
}

export function processSequentially<T, R>(
  items: readonly T[],
  processor: (item: T) => Promise<R>,
  options: QueueOptions = {},
): Promise<R[]> {
  const delay = makeDelay(options)
  return items.reduce(
    (chain: Promise<R[]>, item: T) =>
      chain.then((results) =>
        processor(item).then((result) =>
          delay().then(() => {
            results.push(result)
            return results
          }),
        ),
      ),
    Promise.resolve([] as R[]),
  )
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
  const delay = makeDelay(options)
  return items.reduce(
    (chain: Promise<A>, item: T) => chain.then((acc) => processor(item, acc).then((next) => delay().then(() => next))),
    Promise.resolve(initialAccumulator),
  )
}

/**
 * Process items sequentially and count successful operations.
 */
export function processAndCount<T>(
  items: readonly T[],
  processor: (item: T) => Promise<boolean>,
  options: QueueOptions = {},
): Promise<number> {
  const delay = makeDelay(options)
  return items.reduce(
    (chain: Promise<number>, item: T) =>
      chain.then((count) => processor(item).then((success) => delay().then(() => (success ? count + 1 : count)))),
    Promise.resolve(0),
  )
}
