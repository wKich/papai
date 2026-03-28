import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { logBuffer } from '../../src/debug/log-buffer.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { restoreFetch } from '../test-helpers.js'

const TEST_PORT = 19100

/**
 * Seed the log buffer with known entries so route tests are self-sufficient
 * and don't depend on pino's multistream pipeline (which can be broken by
 * logger mock pollution from other test files in the full suite).
 */
function seedLogBuffer(): void {
  logBuffer.push({ level: 30, time: '2026-03-28T10:00:00.000Z', scope: 'debug-server', msg: 'Debug server started' })
  logBuffer.push({ level: 50, time: '2026-03-28T10:00:01.000Z', scope: 'bot', msg: 'Something failed' })
}

describe('debug-server', () => {
  beforeAll(() => {
    restoreFetch()
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    startDebugServer()
    seedLogBuffer()
  })

  afterAll(() => {
    stopDebugServer()
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
  })

  test('GET /dashboard returns HTML', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html')
    const body = await res.text()
    expect(body).toContain('papai debug dashboard')
  })

  test('GET /events returns SSE headers', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    // Abort the stream to clean up
    await res.body?.cancel()
  })

  test('unknown route returns 404', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/nonexistent`)
    expect(res.status).toBe(404)
    await res.body?.cancel()
  })

  test('GET /logs returns JSON array', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const body: unknown = JSON.parse(await res.text())
    expect(Array.isArray(body)).toBe(true)
    if (!Array.isArray(body)) return
    const entries: unknown[] = body
    expect(entries.length).toBeGreaterThan(0)
  })

  test('GET /logs supports level filter', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs?level=50`)
    expect(res.status).toBe(200)
    const body: unknown = JSON.parse(await res.text())
    if (!Array.isArray(body)) throw new Error('expected array')
    const entries: unknown[] = body
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null || !('level' in entry)) throw new Error('expected log entry')
      expect(entry.level).toBeGreaterThanOrEqual(50)
    }
  })

  test('GET /logs supports scope filter', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs?scope=debug-server`)
    expect(res.status).toBe(200)
    const body: unknown = JSON.parse(await res.text())
    if (!Array.isArray(body)) throw new Error('expected array')
    const entries: unknown[] = body
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null || !('scope' in entry)) throw new Error('expected log entry')
      expect(entry.scope).toBe('debug-server')
    }
  })

  test('GET /logs supports text search', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs?q=Debug%20server`)
    expect(res.status).toBe(200)
    const body: unknown = JSON.parse(await res.text())
    if (!Array.isArray(body)) throw new Error('expected array')
    const entries: unknown[] = body
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null || !('msg' in entry)) throw new Error('expected log entry')
      expect(String(entry.msg).toLowerCase()).toContain('debug server')
    }
  })

  test('GET /logs supports limit', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs?limit=1`)
    expect(res.status).toBe(200)
    const body: unknown = JSON.parse(await res.text())
    if (!Array.isArray(body)) throw new Error('expected array')
    const entries: unknown[] = body
    expect(entries).toHaveLength(1)
  })

  test('GET /logs/stats returns buffer metadata', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs/stats`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const body: unknown = JSON.parse(await res.text())
    expect(body).toHaveProperty('count')
    expect(body).toHaveProperty('capacity', 65535)
    expect(body).toHaveProperty('oldest')
    expect(body).toHaveProperty('newest')
  })

  test('SSE client receives state:init on connect', async () => {
    const controller = new AbortController()
    const res = await fetch(`http://localhost:${TEST_PORT}/events`, { signal: controller.signal })
    const body = res.body
    expect(body).not.toBeNull()

    const chunks: string[] = []
    const decoder = new TextDecoder()
    const writable = new WritableStream<Uint8Array>({
      write(chunk): void {
        chunks.push(decoder.decode(chunk))
        controller.abort()
      },
    })

    try {
      await body!.pipeTo(writable, { signal: controller.signal })
    } catch {
      // Expected: AbortError from controller.abort()
    }

    const text = chunks.join('')
    expect(text).toContain('event: state:init')
    expect(text).toContain('"type":"state:init"')
  })
})
