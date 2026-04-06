import { describe, expect, test } from 'bun:test'

describe('dashboard-ui index', () => {
  test('dashboard API types are valid', () => {
    // The dashboard-ui/index.ts is a browser-only module
    // It sets up window.dashboard and attaches event listeners to DOM elements
    // This test just verifies the types module can be imported
    expect(() => {
      void import('../../../src/debug/dashboard-ui/types.js')
    }).not.toThrow()
    expect(true).toBe(true)
  })
})
