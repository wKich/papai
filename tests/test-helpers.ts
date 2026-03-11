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
