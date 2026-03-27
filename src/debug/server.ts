import { logger } from '../logger.js'
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

let server: ReturnType<typeof Bun.serve> | null = null

export function startDebugServer(): void {
  const port = getPort()

  server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === '/events') {
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
