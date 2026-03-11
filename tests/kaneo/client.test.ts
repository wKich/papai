import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { z } from 'zod'

import { kaneoFetch, KaneoTaskSchema, EmptyResponseSchema } from '../../src/kaneo/client.js'
import { KaneoApiError, KaneoValidationError } from '../../src/kaneo/errors.js'

function setMockFetch(mockFn: (...args: unknown[]) => Promise<Response>): void {
  const originalFetch = globalThis.fetch
  const mockWithProperties = Object.assign(mockFn, {
    preconnect: originalFetch.preconnect,
  })
  globalThis.fetch = mockWithProperties as typeof globalThis.fetch
}

describe('kaneoFetch', () => {
  const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }

  beforeEach(() => {
    mock.restore()
  })

  test('makes GET request with correct headers', async () => {
    let capturedOptions: RequestInit | undefined
    setMockFetch(
      mock((_url: string, options: RequestInit) => {
        capturedOptions = options
        return Promise.resolve(
          new Response(JSON.stringify({ id: '1', title: 'Test', number: 1, status: 'todo', priority: 'medium' }), {
            status: 200,
          }),
        )
      }) as unknown as (...args: unknown[]) => Promise<Response>,
    )

    await kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, KaneoTaskSchema)

    expect(capturedOptions).toBeDefined()
    expect(capturedOptions?.headers).toBeDefined()
  })

  test('throws KaneoApiError on non-ok response', async () => {
    setMockFetch(mock(() => Promise.resolve(new Response('Not found', { status: 404 }))))

    const promise = kaneoFetch(mockConfig, 'GET', '/tasks/1', undefined, {}, KaneoTaskSchema)
    expect(promise).rejects.toBeInstanceOf(KaneoApiError)
    await promise.catch(() => {})
  })

  test('throws KaneoValidationError on schema mismatch', async () => {
    setMockFetch(mock(() => Promise.resolve(new Response(JSON.stringify({ invalid: 'data' }), { status: 200 }))))

    const promise = kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, KaneoTaskSchema)
    expect(promise).rejects.toBeInstanceOf(KaneoValidationError)
    await promise.catch(() => {})
  })

  test('handles non-JSON error response gracefully', async () => {
    setMockFetch(mock(() => Promise.resolve(new Response('Plain text error', { status: 500 }))))

    try {
      await kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, KaneoTaskSchema)
    } catch (error) {
      expect(error).toBeInstanceOf(KaneoApiError)
      if (error instanceof KaneoApiError) {
        expect(error.statusCode).toBe(500)
        expect(error.message).toContain('500')
      }
    }
  })

  test('correctly encodes query parameters', async () => {
    let capturedUrl = ''
    setMockFetch(
      mock((url: string) => {
        capturedUrl = url
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }) as unknown as (...args: unknown[]) => Promise<Response>,
    )

    await kaneoFetch(
      mockConfig,
      'GET',
      '/tasks',
      undefined,
      { search: 'hello world', special: 'a&b=c' },
      z.array(KaneoTaskSchema),
    )

    expect(capturedUrl).toContain('search=hello+world')
    expect(capturedUrl).toContain('special=a%26b%3Dc')
  })

  test('handles DELETE with empty JSON response', async () => {
    setMockFetch(mock(() => Promise.resolve(new Response('{}', { status: 200 }))))

    const result = await kaneoFetch(mockConfig, 'DELETE', '/tasks/1', undefined, {}, EmptyResponseSchema)
    expect(result).toBeDefined()
  })

  test('sends JSON body for POST requests', async () => {
    let capturedBody: unknown
    setMockFetch(
      mock((_url: string, options: RequestInit) => {
        capturedBody = options.body
        return Promise.resolve(
          new Response(JSON.stringify({ id: '1', title: 'New Task', number: 1, status: 'todo', priority: 'medium' }), {
            status: 200,
          }),
        )
      }) as unknown as (...args: unknown[]) => Promise<Response>,
    )

    await kaneoFetch(mockConfig, 'POST', '/tasks', { title: 'New Task' }, {}, KaneoTaskSchema)

    expect(capturedBody).toBe(JSON.stringify({ title: 'New Task' }))
  })

  test('does not send body when undefined', async () => {
    let requestBody: unknown = 'initial'
    setMockFetch(
      mock((_url: string, options: RequestInit) => {
        requestBody = options.body
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      }) as unknown as (...args: unknown[]) => Promise<Response>,
    )

    await kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, EmptyResponseSchema)

    expect(requestBody).toBeUndefined()
  })

  test('uses session cookie when provided', async () => {
    const configWithCookie = {
      ...mockConfig,
      sessionCookie: 'better-auth.session_token=abc123',
    }

    let capturedOptions: RequestInit | undefined
    setMockFetch(
      mock((_url: string, options: RequestInit) => {
        capturedOptions = options
        return Promise.resolve(
          new Response(JSON.stringify({ id: '1', title: 'Test', number: 1, status: 'todo', priority: 'medium' }), {
            status: 200,
          }),
        )
      }) as unknown as (...args: unknown[]) => Promise<Response>,
    )

    await kaneoFetch(configWithCookie, 'GET', '/tasks', undefined, {}, KaneoTaskSchema)

    expect(capturedOptions).toBeDefined()
    expect(capturedOptions?.headers).toBeDefined()
  })

  test('includes status code in KaneoApiError', async () => {
    setMockFetch(mock(() => Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))))

    try {
      await kaneoFetch(mockConfig, 'GET', '/tasks/1', undefined, {}, KaneoTaskSchema)
    } catch (error) {
      expect(error).toBeInstanceOf(KaneoApiError)
      if (error instanceof KaneoApiError) {
        expect(error.statusCode).toBe(404)
        expect(error.responseBody).toEqual({ error: 'Not found' })
      }
    }
  })
})
