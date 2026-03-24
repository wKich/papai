/** Run async tasks with a concurrency limit. Returns settled results in order. */
export async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = Array.from<PromiseSettledResult<T>>({ length: tasks.length })
  let nextIndex = 0

  const executeNext = async (): Promise<void> => {
    if (nextIndex >= tasks.length) return
    const index = nextIndex++
    const task = tasks[index]!
    try {
      const value = await task()
      results[index] = { status: 'fulfilled', value }
    } catch (reason) {
      results[index] = { status: 'rejected', reason }
    }
    return executeNext()
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => executeNext()))
  return results
}
