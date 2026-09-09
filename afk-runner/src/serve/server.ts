// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { ServeFs } from './fs-seam.js'
import { nodeServeFs } from './fs-seam.js'
import { loadPortfolio, loadRunDetail } from './load.js'
import type { RunDetailView } from './run-detail.js'
import type { RosterFingerprints } from './sweep.js'
import { emptyRoster, sweepRuns } from './sweep.js'
import type { PortfolioView } from './view-model.js'

/**
 * The board's zero-dependency HTTP surface (web-board D2/D6/D7): `Bun.serve`
 * with a token gate on every route, the static page, the JSON API, and an SSE
 * stream that pushes a full portfolio snapshot on connect and on every
 * detected change — no client-side patch/merge logic, the client re-renders.
 * Loopback is the default bind; a wider interface is an explicit operator
 * flag. All file access rides the read-only seam.
 */

export const DEFAULT_BOARD_HOST = '127.0.0.1'
export const DEFAULT_BOARD_PORT = 4545
export const DEFAULT_SWEEP_INTERVAL_MS = 2_000

export interface BoardOptions {
  readonly workDir: string
  /** Generated at boot when absent, and printed once by the CLI as the entry URL. */
  readonly token?: string
  readonly host?: string
  readonly port?: number
  readonly sweepIntervalMs?: number
  /** The static page; defaults to the module's own asset. */
  readonly page?: string
  readonly fs?: ServeFs
  readonly loadPortfolio?: (now: Date) => Promise<PortfolioView>
  readonly loadRunDetail?: (runId: string, now: Date) => Promise<RunDetailView | null>
  readonly sweep?: (roster: RosterFingerprints) => Promise<{ changed: readonly string[]; roster: RosterFingerprints }>
  readonly log?: (line: string) => void
}

export interface BoardHandle {
  /** The ready-to-open board URL carrying the token. */
  readonly url: string
  readonly token: string
  stop(): Promise<void>
}

interface Sink {
  readonly push: (chunk: string) => void
}

type ChangeDetector = (
  roster: RosterFingerprints,
) => Promise<{ changed: readonly string[]; roster: RosterFingerprints }>

function authorized(request: Request, token: string): boolean {
  const url = new URL(request.url)
  if (url.searchParams.get('token') === token) return true
  return request.headers.get('authorization') === `Bearer ${token}`
}

function readBoardPage(): string {
  return readFileSync(fileURLToPath(new URL('./static/index.html', import.meta.url)), 'utf8')
}

const chunkOf = (snapshot: PortfolioView): string => `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`

/** The SSE surface (D6): snapshot on connect; the stream registers its sink for broadcasts. */
function sseFactory(sinks: Set<Sink>, loadSnapshot: (now: Date) => Promise<PortfolioView>): () => Response {
  const encoder = new TextEncoder()
  return (): Response => {
    let sink: Sink | null = null
    const stream = new ReadableStream<Uint8Array>({
      async start(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
        const attached: Sink = {
          push(chunk) {
            try {
              controller.enqueue(encoder.encode(chunk))
            } catch {
              sinks.delete(attached)
            }
          },
        }
        sink = attached
        sinks.add(attached)
        attached.push(chunkOf(await loadSnapshot(new Date())))
      },
      cancel(): void {
        if (sink !== null) sinks.delete(sink)
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
}

/** The token-gated routes: page, portfolio JSON, run detail JSON, SSE. */
function routeFactory(deps: {
  readonly token: string
  readonly page: string
  readonly loadSnapshot: (now: Date) => Promise<PortfolioView>
  readonly loadDetail: (runId: string, now: Date) => Promise<RunDetailView | null>
  readonly sse: () => Response
}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (!authorized(request, deps.token)) return new Response('unauthorized\n', { status: 401 })
    const url = new URL(request.url)
    if (url.pathname === '/') {
      return new Response(deps.page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname === '/api/portfolio') return Response.json(await deps.loadSnapshot(new Date()))
    if (url.pathname === '/events') return deps.sse()
    const runMatch = /^\/api\/runs\/([^/]+)$/u.exec(url.pathname)
    if (runMatch !== null) {
      const runId = decodeURIComponent(runMatch[1] ?? '')
      const detail = await deps.loadDetail(runId, new Date())
      if (detail === null) return Response.json({ error: `unknown run: ${runId}` }, { status: 404 })
      return Response.json(detail)
    }
    return Response.json({ error: 'not found' }, { status: 404 })
  }
}

interface BoardRuntime {
  readonly token: string
  readonly host: string
  readonly port: number
  readonly page: string
  readonly log: (line: string) => void
  readonly loadSnapshot: (now: Date) => Promise<PortfolioView>
  readonly loadDetail: (runId: string, now: Date) => Promise<RunDetailView | null>
  readonly detectChanges: ChangeDetector
  readonly intervalMs: number
}

/** Option → runtime resolution: defaults are loopback bind, boot-generated token, 2s sweep. */
function resolveRuntime(options: BoardOptions): BoardRuntime {
  const fs = options.fs ?? nodeServeFs()
  const workDir = options.workDir
  return {
    token: options.token ?? randomBytes(16).toString('hex'),
    host: options.host ?? DEFAULT_BOARD_HOST,
    port: options.port ?? DEFAULT_BOARD_PORT,
    page: options.page ?? readBoardPage(),
    log:
      options.log ??
      ((line: string): void => {
        console.log(line)
      }),
    loadSnapshot: options.loadPortfolio ?? ((now: Date): Promise<PortfolioView> => loadPortfolio(workDir, now)),
    loadDetail:
      options.loadRunDetail ??
      ((runId: string, now: Date): Promise<RunDetailView | null> => loadRunDetail(fs, workDir, runId, now)),
    detectChanges:
      options.sweep ??
      ((roster: RosterFingerprints): Promise<{ changed: readonly string[]; roster: RosterFingerprints }> =>
        sweepRuns(fs, workDir, roster)),
    intervalMs: options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
  }
}

/** The change loop (D5): keepalive ping, sweep, and a full-snapshot broadcast per detected change. */
function startSweepLoop(
  runtime: BoardRuntime,
  sinks: Set<Sink>,
  broadcast: (chunk: string) => void,
): ReturnType<typeof setInterval> {
  let roster: RosterFingerprints = emptyRoster()
  return setInterval(() => {
    // an idle EventSource connection must outlive Bun's default 10s request
    // idleTimeout, and a failed write cleans a dead peer's sink
    for (const sink of [...sinks]) sink.push(': ping\n\n')
    void runtime
      .detectChanges(roster)
      .then(async (result) => {
        roster = result.roster
        if (result.changed.length === 0) return
        broadcast(chunkOf(await runtime.loadSnapshot(new Date())))
      })
      .catch((error: unknown) => {
        runtime.log(`board sweep failed: ${error instanceof Error ? error.message : String(error)}`)
      })
  }, runtime.intervalMs)
}

export function startBoardServer(options: BoardOptions): Promise<BoardHandle> {
  const runtime = resolveRuntime(options)
  const sinks = new Set<Sink>()
  const sse = sseFactory(sinks, runtime.loadSnapshot)
  const broadcast = (chunk: string): void => {
    for (const sink of [...sinks]) sink.push(chunk)
  }
  const sweepTimer = startSweepLoop(runtime, sinks, broadcast)

  const server = Bun.serve({
    hostname: runtime.host,
    port: runtime.port,
    fetch: routeFactory({
      token: runtime.token,
      page: runtime.page,
      loadSnapshot: runtime.loadSnapshot,
      loadDetail: runtime.loadDetail,
      sse,
    }),
    error(error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
    },
  })

  return Promise.resolve({
    url: `${server.url.origin}/?token=${runtime.token}`,
    token: runtime.token,
    async stop() {
      clearInterval(sweepTimer)
      sinks.clear()
      await Promise.resolve(server.stop(true))
    },
  })
}
