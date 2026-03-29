import { logger, logMultistream } from '../logger.js'
import { logBuffer, logBufferStream } from './log-buffer.js'
import { addClient, init, removeClient } from './state-collector.js'

const log = logger.child({ scope: 'debug-server' })

const DEFAULT_PORT = 9100
const DEFAULT_HOSTNAME = '127.0.0.1'

function getPort(): number {
  const env = process.env['DEBUG_PORT']
  if (env !== undefined && env !== '') {
    const parsed = Number.parseInt(env, 10)
    if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) return parsed
  }
  return DEFAULT_PORT
}

function getHostname(): string {
  return process.env['DEBUG_HOSTNAME'] ?? DEFAULT_HOSTNAME
}

function getDebugToken(): string | null {
  return process.env['DEBUG_TOKEN'] ?? null
}

function isAuthorizedRequest(req: Request): boolean {
  const token = getDebugToken()
  // No token required if not set
  if (token === null) return true

  const headerToken = req.headers.get('Authorization')?.replace('Bearer ', '')
  return headerToken === token
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

const DASHBOARD_DIR = new URL('.', import.meta.url).pathname
const jsCache = new Map<string, string>()

async function transpileDashboard(): Promise<void> {
  const entrypoints = [
    new URL('dashboard/dashboard-state.ts', import.meta.url).pathname,
    new URL('dashboard-ui.ts', import.meta.url).pathname,
  ]

  // Validate source files exist and have content before building
  for (const entrypoint of entrypoints) {
    const file = Bun.file(entrypoint)
    const size = file.size
    if (size === 0) {
      log.error({ entrypoint }, 'Dashboard source file is empty, skipping transpilation')
      throw new Error(`Dashboard source file is empty: ${entrypoint}`)
    }
  }

  const buildResult = await Bun.build({
    entrypoints,
  })

  // Validate build outputs have expected content
  const entries = await Promise.all(
    buildResult.outputs.map(async (output) => {
      const name = output.path.split('/').pop() ?? ''
      const content = await output.text()
      if (content.length === 0) {
        log.error({ name }, 'Build output is empty')
        throw new Error(`Build output is empty: ${name}`)
      }
      return [name, content] as const
    }),
  )
  for (const [name, content] of entries) {
    jsCache.set(name, content)
  }

  log.info({ entrypoints: entrypoints.length, outputs: entries.length }, 'Dashboard transpiled successfully')
}

function handleDashboardFile(pathname: string): Response {
  if (pathname === '/dashboard') {
    return new Response(Bun.file(`${DASHBOARD_DIR}dashboard.html`))
  }

  // Remove leading slash to get filename
  const filename = pathname.slice(1)
  const ext = filename.split('.').pop()

  // Serve transpiled JS from cache
  if (ext === 'js') {
    const content = jsCache.get(filename)
    if (content !== undefined) {
      return new Response(content, {
        headers: { 'Content-Type': 'text/javascript' },
      })
    }
    return new Response('Not found', { status: 404 })
  }

  // Serve CSS directly from file
  const ALLOWED_CSS_FILES = new Set(['dashboard.css'])
  if (ext === 'css' && ALLOWED_CSS_FILES.has(filename)) {
    const filePath = `${DASHBOARD_DIR}${filename}`
    const file = Bun.file(filePath)
    return new Response(file)
  }

  return new Response('Not found', { status: 404 })
}

export async function startDebugServer(adminUserId: string): Promise<void> {
  init(adminUserId)
  logMultistream.add({ stream: logBufferStream })
  await transpileDashboard()

  const port = getPort()
  const hostname = getHostname()
  const token = getDebugToken()

  server = Bun.serve({
    port,
    hostname,
    idleTimeout: 0,
    fetch(req) {
      if (!isAuthorizedRequest(req)) {
        return new Response('Unauthorized', { status: 401 })
      }

      const url = new URL(req.url)

      if (url.pathname === '/events') return handleEvents(req)

      if (url.pathname === '/logs') return handleLogs(url)

      if (url.pathname === '/logs/stats') {
        return new Response(JSON.stringify(logBuffer.stats()), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (
        url.pathname === '/dashboard' ||
        url.pathname.startsWith('/dashboard.') ||
        url.pathname.startsWith('/dashboard-')
      ) {
        return handleDashboardFile(url.pathname)
      }

      return new Response('Not found', { status: 404 })
    },
  })

  log.info({ port, hostname, authEnabled: token !== null }, 'Debug server started')
}

export function stopDebugServer(): void {
  if (server !== null) {
    void server.stop()
    server = null
    log.info('Debug server stopped')
  }
}
