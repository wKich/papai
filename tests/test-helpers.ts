import { mock } from 'bun:test'

const originalFetch = globalThis.fetch

export function restoreFetch(): void {
  globalThis.fetch = originalFetch
}

export interface ToolExecutor {
  execute: (...args: unknown[]) => Promise<unknown>
}

export function hasExecute(tool: unknown): tool is ToolExecutor {
  return (
    typeof tool === 'object' &&
    tool !== null &&
    'execute' in tool &&
    typeof (tool as Record<string, unknown>)['execute'] === 'function'
  )
}

export function getToolExecutor(tool: unknown): (...args: unknown[]) => Promise<unknown> {
  if (hasExecute(tool)) {
    return tool.execute
  }
  throw new Error('Tool does not have an execute method')
}

/**
 * Replace globalThis.fetch with a mock handler for testing.
 * Wraps `mock()` internally so callers don't need `as unknown as` casts.
 */
export function setMockFetch(handler: (url: string, init: RequestInit) => Promise<Response>): void {
  const mocked = mock(handler)
  const wrapped = Object.assign(
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return mocked(url, init ?? {})
    },
    { preconnect: originalFetch.preconnect },
  )
  globalThis.fetch = wrapped
}

// Module mock restoration helpers
const originalModules = new Map<string, unknown>()

export function storeOriginalModule(path: string, original: unknown): void {
  if (!originalModules.has(path)) {
    originalModules.set(path, original)
  }
}

export function restoreModule(path: string): void {
  const original = originalModules.get(path)
  if (original !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    void mock.module(path, () => original as Record<string, unknown>)
    originalModules.delete(path)
  }
}

export function restoreAllModules(): void {
  for (const [path, original] of originalModules) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    void mock.module(path, () => original as Record<string, unknown>)
  }
  originalModules.clear()
}

export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(() => {
      resolve()
    })
  })
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, 0)
  })
}
