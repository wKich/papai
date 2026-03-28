import { logger, logMultistream } from '../logger.js'
import { logBuffer, logBufferStream } from './log-buffer.js'
import { addClient, removeClient } from './state-collector.js'

const log = logger.child({ scope: 'debug-server' })

const DEFAULT_PORT = 9100

function getPort(): number {
  const env = process.env['DEBUG_PORT']
  if (env !== undefined && env !== '') {
    const parsed = Number.parseInt(env, 10)
    if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) return parsed
  }
  return DEFAULT_PORT
}

function handleEvents(req: Request): Response {
  let ctrl: ReadableStreamDefaultController
  const stream = new ReadableStream({
    start(controller): void {
      ctrl = controller
      addClient(controller)
      req.signal.addEventListener('abort', () => {
        removeClient(controller)
      })
    },
    cancel(): void {
      removeClient(ctrl)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function parseIntParam(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

function handleLogs(url: URL): Response {
  const results = logBuffer.search({
    level: parseIntParam(url.searchParams.get('level')),
    scope: url.searchParams.get('scope') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    limit: parseIntParam(url.searchParams.get('limit')),
  })

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  })
}

let server: ReturnType<typeof Bun.serve> | null = null

export function startDebugServer(): void {
  logMultistream.add({ stream: logBufferStream })

  const port = getPort()

  server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === '/events') return handleEvents(req)

      if (url.pathname === '/logs') return handleLogs(url)

      if (url.pathname === '/logs/stats') {
        return new Response(JSON.stringify(logBuffer.stats()), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.pathname === '/dashboard') {
        return new Response('<html><body><h1>papai debug dashboard</h1><p>Coming in Session 4</p></body></html>', {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      return new Response('Not found', { status: 404 })
    },
  })

  log.info({ port }, 'Debug server started')
}

export function stopDebugServer(): void {
  if (server !== null) {
    void server.stop()
    server = null
    log.info('Debug server stopped')
  }
}
