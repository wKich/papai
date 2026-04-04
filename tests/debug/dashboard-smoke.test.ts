import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { logBuffer } from '../../src/debug/log-buffer.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { restoreFetch } from '../test-helpers.js'

const TEST_PORT = 19101

describe('dashboard-smoke', () => {
  beforeAll(async () => {
    restoreFetch()
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    await startDebugServer('test-admin')
  })

  afterAll(() => {
    stopDebugServer()
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
  })

  describe('dashboard-ui.js', () => {
    test('returns JavaScript with IIFE format (no ES module export statements)', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-ui.js`)
      expect(res.status).toBe(200)

      const body = await res.text()

      // Should not contain ES module export statements that cause browser errors
      expect(body).not.toContain('export *')
      expect(body).not.toContain('export {')
      expect(body).not.toContain('export default')

      // Should contain IIFE wrapper or be assignable to window
      expect(body).toContain('window.dashboard')
    })

    test('contains dashboard initialization code', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-ui.js`)
      const body = await res.text()

      // Should have DOM element references
      expect(body).toContain('getElementById')
      expect(body).toContain('connection-status')
      expect(body).toContain('log-entries')

      // Should have render functions
      expect(body).toContain('renderConnection')
      expect(body).toContain('renderStats')
      expect(body).toContain('renderLogs')
    })

    test('initializes window.dashboard object', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-ui.js`)
      const body = await res.text()

      // Should check for and initialize window.dashboard
      expect(body).toContain('window.dashboard')
      expect(body).toContain('typeof window.dashboard === "undefined"')
    })
  })

  describe('dashboard-state.js', () => {
    test('returns JavaScript with IIFE format (no ES module export statements)', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-state.js`)
      expect(res.status).toBe(200)

      const body = await res.text()

      // Should not contain ES module export statements that cause browser errors
      expect(body).not.toContain('export *')
      expect(body).not.toContain('export {')
      expect(body).not.toContain('export default')

      // Should use window for shared state instead of ES modules
      expect(body).toContain('window.dashboard')
    })

    test('contains state management and SSE setup', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-state.js`)
      const body = await res.text()

      // Should have EventSource for SSE
      expect(body).toContain('EventSource')
      expect(body).toContain('addEventListener')

      // Should handle state events
      expect(body).toContain('state:init')
      expect(body).toContain('state:stats')
      expect(body).toContain('log:entry')
    })
  })

  describe('dashboard.html', () => {
    test('loads the dashboard page with correct script references', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard`)
      expect(res.status).toBe(200)

      const body = await res.text()

      // Should reference both JS files
      expect(body).toContain('dashboard-ui.js')
      expect(body).toContain('dashboard-state.js')

      // Should have all required DOM elements
      expect(body).toContain('id="connection-status"')
      expect(body).toContain('id="session-list"')
      expect(body).toContain('id="log-entries"')
      expect(body).toContain('id="trace-list"')
    })
  })

  describe('dashboard.css', () => {
    test('returns CSS styling', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.css`)
      expect(res.status).toBe(200)

      const body = await res.text()

      // Should have basic CSS
      expect(body).toContain('{')
      expect(body).toContain('}')
    })
  })

  describe('JavaScript syntax validation', () => {
    test('dashboard-ui.js can be parsed without syntax errors', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-ui.js`)
      const body = await res.text()

      // Should be parseable JavaScript (no ES module syntax errors in browser)
      // The IIFE format should wrap everything
      expect(body.startsWith('(') || body.startsWith('!')).toBe(true)
      expect(body).toContain('var ')

      // Should not have ES module import/export statements that would fail in browser
      expect(body).not.toMatch(/^import /m)
      expect(body).not.toMatch(/^export /m)
      expect(body).not.toContain('export *')
      expect(body).not.toContain('export {')
      expect(body).not.toContain('export default')
    })

    test('dashboard-state.js can be parsed without syntax errors', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-state.js`)
      const body = await res.text()

      // Should be parseable JavaScript
      expect(body.startsWith('(') || body.startsWith('!')).toBe(true)
      expect(body).toContain('var ')

      // Should not have ES module import/export statements
      expect(body).not.toMatch(/^import /m)
      expect(body).not.toMatch(/^export /m)
      expect(body).not.toContain('export *')
      expect(body).not.toContain('export {')
      expect(body).not.toContain('export default')
    })
  })
})
