import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { getUserMessage, webFetchError } from '../../src/errors.js'
import { safeFetchContent } from '../../src/web/safe-fetch.js'
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
    const fetchMock = createFetchMock(
      (..._args: Parameters<typeof fetch>): Promise<Response> =>
        Promise.resolve(
          new Response('not allowed', {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        ),
    )

    try {
      await safeFetchContent(
        'https://example.com/file',
        { abortSignal: AbortSignal.timeout(1000) },
        {
          fetch: fetchMock,
          assertPublicUrl: (): Promise<void> => Promise.resolve(),
        },
      )
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.blockedContentType()))
      if (!hasAppError(error)) {
        throw new Error('Expected error with appError', { cause: error })
      }
      expect(error.appError).toEqual(webFetchError.blockedContentType())
    }
  })

  test('rejects oversized text bodies', async () => {
    const fetchMock = createFetchMock(
      (..._args: Parameters<typeof fetch>): Promise<Response> =>
        Promise.resolve(
          new Response('x'.repeat(2_000_001), {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          }),
        ),
    )

    try {
      await safeFetchContent(
        'https://example.com/large',
        { abortSignal: AbortSignal.timeout(1000) },
        {
          fetch: fetchMock,
          assertPublicUrl: (): Promise<void> => Promise.resolve(),
        },
      )
      throw new Error('Expected safeFetchContent to reject')
    } catch (error) {
      expectAppError(error, getUserMessage(webFetchError.tooLarge()))
      if (!hasAppError(error)) {
        throw new Error('Expected error with appError', { cause: error })
      }
      expect(error.appError).toEqual(webFetchError.tooLarge())
    }
  })
})
