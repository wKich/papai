import { beforeEach, describe, expect, test } from 'bun:test'

import { validateLlmApiKey } from '../../src/wizard/validation.js'

describe('validateLlmApiKey', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  test('should return success for valid API key', async () => {
    globalThis.fetch = Object.assign(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'gpt-4' }] }),
        }),
      { preconnect: globalThis.fetch.preconnect },
    ) as unknown as typeof fetch
    const result = await validateLlmApiKey('sk-test', 'https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })
})

describe('validateLlmApiKey with mocked fetch', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  test('should succeed when API returns 200', async () => {
    globalThis.fetch = Object.assign(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'gpt-4' }] }),
        }),
      { preconnect: globalThis.fetch.preconnect },
    ) as unknown as typeof fetch

    const result = await validateLlmApiKey('sk-valid', 'https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })

  test('should fail when API returns 401', async () => {
    globalThis.fetch = Object.assign(
      () =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        }),
      { preconnect: globalThis.fetch.preconnect },
    ) as unknown as typeof fetch

    const result = await validateLlmApiKey('sk-invalid', 'https://api.openai.com/v1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('Invalid API key')
  })
})
