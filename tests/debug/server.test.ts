import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { restoreFetch } from '../test-helpers.js'

const TEST_PORT = 19100

describe('debug-server', () => {
  beforeAll(() => {
    restoreFetch()
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    startDebugServer()
  })

  afterAll(() => {
    stopDebugServer()
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
