/// <reference lib="dom" />
import { bootstrapLogs } from './logs-bootstrap.js'
import { setupEventSource } from './sse.js'

async function init(): Promise<void> {
  try {
    await bootstrapLogs()
  } catch {
    // Log bootstrap failed — will populate from SSE events
  }

  setupEventSource()
}

void init()
