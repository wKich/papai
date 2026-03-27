import { subscribe, unsubscribe, type DebugEvent } from './event-bus.js'

const clients = new Set<ReadableStreamDefaultController>()
const encoder = new TextEncoder()

/** @public -- called by server.ts on new SSE connection */
export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller)

  sendTo(controller, { type: 'state:init', timestamp: Date.now(), data: {} })

  if (clients.size === 1) {
    subscribe(onEvent)
  }
}

/** @public -- called by server.ts on SSE disconnect */
export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller)

  if (clients.size === 0) {
    unsubscribe(onEvent)
  }
}

function onEvent(event: DebugEvent): void {
  const payload = formatSse(event)
  for (const client of clients) {
    try {
      client.enqueue(payload)
    } catch {
      clients.delete(client)
    }
  }
}

function sendTo(controller: ReadableStreamDefaultController, event: DebugEvent): void {
  try {
    controller.enqueue(formatSse(event))
  } catch {
    clients.delete(controller)
  }
}

function formatSse(event: DebugEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}
