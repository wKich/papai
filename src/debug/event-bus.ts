export type DebugEvent = {
  type: string
  timestamp: number
  data: Record<string, unknown>
}

type Listener = (event: DebugEvent) => void

const listeners = new Set<Listener>()

/** @public -- consumed by source modules in Session 3 */
export function emit(type: string, data: Record<string, unknown>): void {
  if (listeners.size === 0) return
  const event: DebugEvent = { type, timestamp: Date.now(), data }
  for (const fn of listeners) fn(event)
}

export function subscribe(fn: Listener): void {
  listeners.add(fn)
}

export function unsubscribe(fn: Listener): void {
  listeners.delete(fn)
}
