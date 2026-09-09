// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { BoardHandle, BoardOptions } from '../../../afk-runner/src/serve/server.js'
import { startBoardServer } from '../../../afk-runner/src/serve/server.js'

/**
 * The serve verb's HTTP surface (web-board D2/D6/D7): token gate on every
 * route, static page, JSON API, and the SSE stream that pushes a full
 * portfolio snapshot on connect and on every detected change. Deps are
 * injected; the read-only proof compares corpus bytes around live appends.
 */

const TOKEN = 'secret'
const SWEEP_MS = 15

const tmpDirs: string[] = []
let openHandle: BoardHandle | null = null

afterEach(async () => {
  await openHandle?.stop()
  openHandle = null
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-board-server-'))
  tmpDirs.push(dir)
  return dir
}

function at(offsetMs: number): string {
  return new Date(Date.parse('2026-09-01T00:00:00.000Z') + offsetMs).toISOString()
}

function line(event: Record<string, unknown>): string {
  return JSON.stringify(event)
}

function stageEnter(stage: string, seq: number, ts: string): string {
  return line({ altitude: 'L2', type: 'stage_enter', stage, seq, ts })
}

function stageExit(stage: string, seq: number, ts: string): string {
  return line({ altitude: 'L2', type: 'stage_exit', stage, seq, ts })
}

function writeRunDir(workDir: string, runId: string, events: readonly string[], memo: Record<string, unknown>): string {
  const runDir = path.join(workDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'events.ndjson'), `${events.join('\n')}\n`)
  fs.writeFileSync(
    path.join(runDir, 'state.json'),
    `${JSON.stringify({ runId, repoRoot: workDir, workDir, stage: 'review', depth: 'S', round: 1, createdAt: memo['updatedAt'], ...memo }, null, 2)}\n`,
  )
  return runDir
}

/** One parked gate, one live run, one completed run. */
function writeRunsFixture(workDir: string): void {
  writeRunDir(
    workDir,
    'gate-run',
    [
      stageEnter('intake', 1, at(1 * 60_000)),
      stageExit('intake', 2, at(1 * 60_000)),
      stageEnter('draft', 3, at(2 * 60_000)),
      stageExit('draft', 4, at(2 * 60_000)),
      stageEnter('review', 5, at(3 * 60_000)),
      line({
        altitude: 'L2',
        type: 'gate',
        action: 'presented',
        mode: 'early',
        version: 1,
        seq: 6,
        ts: at(6 * 60_000),
      }),
    ],
    { status: 'running', gate: { mode: 'early', version: 1 }, updatedAt: at(6 * 60_000) },
  )
  writeRunDir(
    workDir,
    'live-run',
    [
      stageEnter('intake', 1, at(1 * 60_000)),
      stageExit('intake', 2, at(1 * 60_000)),
      stageEnter('draft', 3, at(3 * 60_000)),
    ],
    { status: 'running', gate: null, updatedAt: at(3 * 60_000) },
  )
  writeRunDir(
    workDir,
    'done-run',
    [
      stageEnter('intake', 1, at(1 * 60_000)),
      stageExit('intake', 2, at(1 * 60_000)),
      stageEnter('review', 3, at(2 * 60_000)),
      line({ altitude: 'L2', type: 'round_open', round: 1, cap: 1, seq: 4, ts: at(2 * 60_000) }),
      line({
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        seq: 5,
        ts: at(3 * 60_000),
      }),
      stageExit('review', 6, at(3 * 60_000)),
      stageEnter('gate', 7, at(4 * 60_000)),
      line({
        altitude: 'L2',
        type: 'gate',
        action: 'presented',
        mode: 'final',
        version: 1,
        seq: 8,
        ts: at(4 * 60_000),
      }),
      stageExit('gate', 9, at(5 * 60_000)),
      line({
        altitude: 'L2',
        type: 'gate',
        action: 'answered',
        mode: 'final',
        version: 1,
        outcome: 'approve',
        seq: 10,
        ts: at(5 * 60_000),
      }),
    ],
    { status: 'completed', gate: null, updatedAt: at(5 * 60_000) },
  )
  fs.writeFileSync(path.join(workDir, 'runs', 'gate-run', 'gate-1.md'), '## Early gate\n→ <answer or OVERRIDE>\n')
}

async function startBoard(workDir: string, overrides: Partial<BoardOptions> = {}): Promise<BoardHandle> {
  const handle = await startBoardServer({
    workDir,
    token: TOKEN,
    port: 0,
    sweepIntervalMs: SWEEP_MS,
    page: '<!doctype html><html><body>board</body></html>',
    log: (l: string): void => console.error('BOARD:', l),
    ...overrides,
  })
  openHandle = handle
  return handle
}

function originOf(handle: BoardHandle): string {
  return new URL(handle.url).origin
}

/** Content + mtime snapshot of every file under dir (the passive-read-only oracle). */
function snapshotTree(dir: string): Record<string, { content: string; mtimeMs: number }> {
  const snap: Record<string, { content: string; mtimeMs: number }> = {}
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const stat = fs.statSync(full)
        snap[path.relative(dir, full)] = { content: fs.readFileSync(full, 'utf8'), mtimeMs: stat.mtimeMs }
      }
    }
  }
  walk(dir)
  return snap
}

interface StreamReader {
  readonly text: string
  readUntil(predicate: (text: string) => boolean, budgetMs?: number): Promise<string>
  close(): Promise<void>
}

function streamReader(response: Response): StreamReader {
  if (response.body === null) throw new Error('SSE response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const state = { text: '' }
  return {
    get text(): string {
      return state.text
    },
    async readUntil(predicate: (text: string) => boolean, budgetMs = 10_000): Promise<string> {
      const deadline = Date.now() + budgetMs
      while (!predicate(state.text)) {
        if (Date.now() > deadline) throw new Error(`SSE snapshot timeout; received so far: ${state.text.slice(0, 400)}`)
        const next = await reader.read()
        if (next.done) break
        state.text += decoder.decode(next.value, { stream: true })
      }
      return state.text
    },
    async close(): Promise<void> {
      await reader.cancel().catch(() => undefined)
    },
  }
}

function snapshotCount(text: string): number {
  return (text.match(/event: snapshot\n/gu) ?? []).length
}

function snapshotsOf(text: string): readonly unknown[] {
  return [...text.matchAll(/event: snapshot\ndata: (.+)\n\n/gu)].map((match) => JSON.parse(match[1] ?? '{}') as unknown)
}

describe('serve server — token gate on every route', () => {
  it('rejects missing and wrong tokens on every route without revealing run data', async () => {
    const workDir = makeWorkDir()
    writeRunsFixture(workDir)
    const board = await startBoard(workDir)
    const origin = originOf(board)
    for (const route of [
      '/',
      '/api/portfolio',
      '/api/runs/gate-run',
      '/api/runs/gate-run/events?before=10',
      '/events',
    ] as const) {
      const none = await fetch(`${origin}${route}`)
      expect(none.status).toBe(401)
      expect(await none.text()).not.toContain('gate-run')
      const wrong = await fetch(`${origin}${route}?token=nope`)
      expect(wrong.status).toBe(401)
    }
  })

  it('admits the query token and the bearer header', async () => {
    const workDir = makeWorkDir()
    writeRunsFixture(workDir)
    const board = await startBoard(workDir)
    const origin = originOf(board)
    const viaQuery = await fetch(`${origin}/api/portfolio?token=${TOKEN}`)
    expect(viaQuery.status).toBe(200)
    const viaHeader = await fetch(`${origin}/api/portfolio`, { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(viaHeader.status).toBe(200)
  })
})

describe('serve server — the routes', () => {
  it('serves the static page, the attention-sorted portfolio, and run detail', async () => {
    const workDir = makeWorkDir()
    writeRunsFixture(workDir)
    const board = await startBoard(workDir)
    const origin = originOf(board)
    const page = await fetch(`${origin}/?token=${TOKEN}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('board')
    const portfolio: unknown = await (await fetch(`${origin}/api/portfolio?token=${TOKEN}`)).json()
    expect(portfolio).toMatchObject({
      cards: [{ runId: 'gate-run' }, { runId: 'live-run' }, { runId: 'done-run' }],
      totals: { runs: 3, gatePending: 1, running: 1, finished: 1 },
    })
    const detail: unknown = await (await fetch(`${origin}/api/runs/gate-run?token=${TOKEN}`)).json()
    expect(detail).toMatchObject({
      gate: { mode: 'early', version: 1, file: 'gate-1.md' },
      position: 'gate.awaiting',
    })
    expect(JSON.stringify(detail)).toContain('Early gate')
    const missing = await fetch(`${origin}/api/runs/no-such-run?token=${TOKEN}`)
    expect(missing.status).toBe(404)
    const stray = await fetch(`${origin}/api/nothing?token=${TOKEN}`)
    expect(stray.status).toBe(404)
  })
})

describe('serve server — the event history pagination route', () => {
  it('pages strictly below `before`, ascending, applying the feed exclusions', async () => {
    const workDir = makeWorkDir()
    writeRunsFixture(workDir)
    const board = await startBoard(workDir)
    const origin = originOf(board)
    const page: unknown = await (
      await fetch(`${origin}/api/runs/done-run/events?before=8&limit=3&token=${TOKEN}`)
    ).json()
    expect(page).toMatchObject({
      events: [
        { seq: 5, summary: 'convergence r1 converged' },
        { seq: 6, summary: 'stage_exit review' },
        { seq: 7, summary: 'stage_enter gate' },
      ],
    })
  })

  it('rejects a missing or non-numeric before and an unknown run', async () => {
    const workDir = makeWorkDir()
    writeRunsFixture(workDir)
    const board = await startBoard(workDir)
    const origin = originOf(board)
    const noBefore = await fetch(`${origin}/api/runs/done-run/events?token=${TOKEN}`)
    expect(noBefore.status).toBe(400)
    const badBefore = await fetch(`${origin}/api/runs/done-run/events?before=soon&token=${TOKEN}`)
    expect(badBefore.status).toBe(400)
    const unknown = await fetch(`${origin}/api/runs/no-such-run/events?before=5&token=${TOKEN}`)
    expect(unknown.status).toBe(404)
  })

  it('a below-tail page is immutable while the run appends, and the torn tail tolerates', async () => {
    const workDir = makeWorkDir()
    writeRunsFixture(workDir)
    const board = await startBoard(workDir)
    const origin = originOf(board)
    const first = await fetch(`${origin}/api/runs/live-run/events?before=4&limit=2&token=${TOKEN}`)
    const firstBody = await first.text()
    expect(first.status).toBe(200)
    // the run appends (a complete line and a torn in-flight tail) — the
    // below-tail page must return identical content
    fs.appendFileSync(
      path.join(workDir, 'runs', 'live-run', 'events.ndjson'),
      `${stageExit('draft', 4, at(30 * 60_000))}\n{"altitude":"L2","type":"ga`,
    )
    const second = await fetch(`${origin}/api/runs/live-run/events?before=4&limit=2&token=${TOKEN}`)
    expect(await second.text()).toBe(firstBody)
    // the appended tail itself pages on the next fetch
    const grown: unknown = await (
      await fetch(`${origin}/api/runs/live-run/events?before=5&limit=2&token=${TOKEN}`)
    ).json()
    expect(grown).toMatchObject({
      events: [
        { seq: 3, summary: 'stage_enter draft' },
        { seq: 4, summary: 'stage_exit draft' },
      ],
    })
  })
})

describe('serve server — SSE pushes full snapshots', () => {
  it('sends the current snapshot on connect and a fresh one when an event lands', async () => {
    const workDir = makeWorkDir()
    writeRunsFixture(workDir)
    const board = await startBoard(workDir)
    const origin = originOf(board)
    const response = await fetch(`${origin}/events?token=${TOKEN}`)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const stream = streamReader(response)
    await stream.readUntil((text) => snapshotCount(text) >= 1)
    const first = snapshotsOf(stream.text)[0]
    expect(first).toMatchObject({ totals: { gatePending: 1 } })

    const appended = `${stageExit('draft', 4, at(30 * 60_000))}\n`
    fs.appendFileSync(path.join(workDir, 'runs', 'live-run', 'events.ndjson'), appended)
    // wait for the appended state itself (the event's ts surfaces as the card's
    // lastActivity) — a bare snapshot count would race the pre-append sweep tick
    await stream.readUntil((text) => text.includes(at(30 * 60_000)), 5_000)
    const second = snapshotsOf(stream.text)[1]
    expect(second).toMatchObject({
      totals: { runs: 3 },
      cards: [{ runId: 'gate-run' }, { runId: 'live-run', stage: 'draft' }, { runId: 'done-run' }],
    })
    await stream.close()
  })

  it('a new run directory grows the portfolio on a later sweep', async () => {
    const workDir = makeWorkDir()
    writeRunsFixture(workDir)
    const board = await startBoard(workDir)
    const origin = originOf(board)
    const response = await fetch(`${origin}/events?token=${TOKEN}`)
    const stream = streamReader(response)
    await stream.readUntil((text) => snapshotCount(text) >= 1)
    writeRunDir(workDir, 'run-new', [stageEnter('intake', 1, at(40 * 60_000))], {
      status: 'running',
      gate: null,
      updatedAt: at(40 * 60_000),
    })
    // wait for the new run's card itself — a bare snapshot count would race
    // the sweep tick that ran before the run dir appeared
    await stream.readUntil((text) => text.includes('run-new'), 5_000)
    const latest = snapshotsOf(stream.text).at(-1)
    expect(latest).toMatchObject({ totals: { runs: 4 } })
    expect(JSON.stringify(latest)).toContain('run-new')
    await stream.close()
  })
})

describe('serve server — the read-only proof (3.5)', () => {
  it('serving a live work dir writes nothing beyond the live appends themselves', async () => {
    const workDir = makeWorkDir()
    writeRunsFixture(workDir)
    const before = snapshotTree(workDir)
    const board = await startBoard(workDir)
    const origin = originOf(board)
    // the board sweeps while a live run appends and a gate stays parked
    const response = await fetch(`${origin}/events?token=${TOKEN}`)
    const stream = streamReader(response)
    await stream.readUntil((text) => snapshotCount(text) >= 1)
    const appended = `${stageExit('draft', 4, at(30 * 60_000))}\n`
    fs.appendFileSync(path.join(workDir, 'runs', 'live-run', 'events.ndjson'), appended)
    await fetch(`${origin}/api/portfolio?token=${TOKEN}`)
    await stream.readUntil((text) => snapshotCount(text) >= 2, 5_000)
    await stream.close()
    await board.stop()
    openHandle = null
    // every artifact is byte-identical to pre-serve except the appended log,
    // which grew by exactly the appended line — the board itself wrote nothing
    const after = snapshotTree(workDir)
    const appendedPath = path.join('runs', 'live-run', 'events.ndjson')
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    const untouched = Object.entries(before).filter(([file]) => file !== appendedPath)
    for (const [file, entry] of untouched) {
      expect(after[file]?.content).toBe(entry.content)
    }
    const beforeLog: { readonly content: string } | undefined = before[appendedPath]
    const afterLog: { readonly content: string } | undefined = after[appendedPath]
    expect(afterLog?.content).toBe(`${beforeLog?.content}${appended}`)
  })
})
