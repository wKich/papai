import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { getUserMessage, webFetchError } from '../../src/errors.js'
import { safeFetchContent, type SafeFetchDeps } from '../../src/web/safe-fetch.js'
import { expectAppError, mockLogger } from '../utils/test-helpers.js'

function createFetchMock(impl: (...args: Parameters<typeof fetch>) => Promise<Response>): typeof fetch {
  return Object.assign(impl, { preconnect: fetch.preconnect })
}

function hasAppError(error: unknown): error is Error & { appError: unknown } {
  return error instanceof Error && 'appError' in error
}

describe('safeFetchContent', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('validates the initial URL and each redirect target', async () => {
    const assertPublicUrl = mock((_url: URL): Promise<void> => Promise.resolve())
    let fetchCount = 0
    const fetchMock = createFetchMock((..._args: Parameters<typeof fetch>): Promise<Response> => {
      fetchCount += 1
      if (fetchCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: 'https://example.com/final' },
          }),
        )
      }

      return Promise.resolve(
        new Response('<html><body>Hello</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      )
    })

    const result = await safeFetchContent(
      'https://example.com/start',
      { abortSignal: AbortSignal.timeout(1000) },
      { fetch: fetchMock, assertPublicUrl },
    )

    expect(result.finalUrl).toBe('https://example.com/final')
    expect(result.contentType).toBe('text/html')
    expect(new TextDecoder().decode(result.body)).toContain('Hello')
    expect(assertPublicUrl).toHaveBeenCalledTimes(2)
  })

  test('rejects unsupported content types', async () => {
    const deps: SafeFetchDeps = {
      fetch: createFetchMock(
        (..._args: Parameters<typeof fetch>): Promise<Response> =>
          Promise.resolve(
            new Response('not allowed', {
              status: 200,
              headers: { 'content-type': 'image/png' },
            }),
          ),
      ),
      assertPublicUrl: (): Promise<void> => Promise.resolve(),
    }

    try {
      await safeFetchContent('https://example.com/file', { abortSignal: AbortSignal.timeout(1000) }, deps)
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.blockedContentType()))
      if (!hasAppError(error)) {
        throw new Error('Expected error with appError', { cause: error })
      }
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'blocked-content-type',
        appError: webFetchError.blockedContentType(),
      })
    }
  })

  test('rejects oversized text bodies', async () => {
    const deps: SafeFetchDeps = {
      fetch: createFetchMock(
        (..._args: Parameters<typeof fetch>): Promise<Response> =>
          Promise.resolve(
            new Response('x'.repeat(2_000_001), {
              status: 200,
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            }),
          ),
      ),
      assertPublicUrl: (): Promise<void> => Promise.resolve(),
    }

    try {
      await safeFetchContent('https://example.com/large', { abortSignal: AbortSignal.timeout(1000) }, deps)
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.tooLarge()))
      if (!hasAppError(error)) {
        throw new Error('Expected error with appError', { cause: error })
      }
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'too-large',
        appError: webFetchError.tooLarge(),
      })
    }
  })

  test('maps timeout errors to the web-fetch timeout shape', async () => {
    const deps: SafeFetchDeps = {
      fetch: createFetchMock((_input: Parameters<typeof fetch>[0]): Promise<Response> => {
        throw new DOMException('Timed out', 'TimeoutError')
      }),
      assertPublicUrl: (): Promise<void> => Promise.resolve(),
    }

    try {
      await safeFetchContent('https://example.com/slow', { abortSignal: AbortSignal.timeout(1000) }, deps)
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.timeout()))
      if (!hasAppError(error)) {
        throw new Error('Expected error with appError', { cause: error })
      }
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'timeout',
        appError: webFetchError.timeout(),
      })
    }
  })

  test('maps URL-validation timeouts to the web-fetch timeout shape', async () => {
    const abortController = new AbortController()
    abortController.abort(new DOMException('Timed out', 'TimeoutError'))

    const deps: SafeFetchDeps = {
      fetch: createFetchMock((_input: Parameters<typeof fetch>[0]): Promise<Response> => {
        throw new Error('fetch should not be called when validation times out')
      }),
      assertPublicUrl: (): Promise<void> => new Promise(() => {}),
    }

    try {
      await safeFetchContent('https://example.com/slow', { abortSignal: abortController.signal }, deps)
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.timeout()))
      if (!hasAppError(error)) {
        throw new Error('Expected error with appError', { cause: error })
      }
      expect(error).toMatchObject({
        type: 'web-fetch',
        code: 'timeout',
        appError: webFetchError.timeout(),
      })
    }
  })
})
