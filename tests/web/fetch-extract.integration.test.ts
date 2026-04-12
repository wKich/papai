import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { setCachedConfig } from '../../src/cache.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type FetchAndExtract = typeof import('../../src/web/fetch-extract.js').fetchAndExtract
type SafeFetchContent = typeof import('../../src/web/safe-fetch.js').safeFetchContent

const HTML_PATH = '/html'
const REDIRECT_PATH = '/redirect'
const FIXTURE_TITLE = 'Local Fixture Title'
const FIXTURE_BODY = 'Local fixture body content for extraction.'

describe('fetchAndExtract integration', () => {
  let fetchAndExtract: FetchAndExtract
  let safeFetchContent: SafeFetchContent
  let server: ReturnType<typeof Bun.serve> | null = null
  let baseUrl = ''

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    ;({ fetchAndExtract } = await import('../../src/web/fetch-extract.js'))
    ;({ safeFetchContent } = await import('../../src/web/safe-fetch.js'))

    setCachedConfig('ctx-1', 'llm_apikey', 'test-key')
    setCachedConfig('ctx-1', 'llm_baseurl', 'https://llm.example.test')
    setCachedConfig('ctx-1', 'main_model', 'gpt-main')

    server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === HTML_PATH) {
          return new Response(
            `<!doctype html>
            <html>
              <head><title>${FIXTURE_TITLE}</title></head>
              <body>
                <main>
                  <article>
                    <h1>${FIXTURE_TITLE}</h1>
                    <p>${FIXTURE_BODY}</p>
                  </article>
                </main>
              </body>
            </html>`,
            {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            },
          )
        }

        if (url.pathname === REDIRECT_PATH) {
          return new Response(null, {
            status: 302,
            headers: { location: `${baseUrl}${HTML_PATH}` },
          })
        }

        return new Response('not found', { status: 404 })
      },
    })

    baseUrl = server.url.origin
  })

  afterEach(async () => {
    await server?.stop(true)
    server = null
    baseUrl = ''
  })

  test('returns a fetch result first and a cache result on the second request', async () => {
    const url = `${baseUrl}${HTML_PATH}`
    const safeFetchOverride = (
      targetUrl: string,
      options?: { abortSignal?: AbortSignal },
    ): ReturnType<SafeFetchContent> => safeFetchContent(targetUrl, options, { fetch, assertPublicUrl: async () => {} })

    const first = await fetchAndExtract(
      {
        storageContextId: 'ctx-1',
        url,
      },
      { safeFetchContent: safeFetchOverride },
    )

    const second = await fetchAndExtract(
      {
        storageContextId: 'ctx-1',
        url,
      },
      { safeFetchContent: safeFetchOverride },
    )

    expect(first.url).toBe(url)
    expect(first.title).toBe(FIXTURE_TITLE)
    expect(first.summary).toContain(FIXTURE_BODY)
    expect(first.excerpt).toContain(FIXTURE_BODY)
    expect(first.contentType).toBe('text/html')
    expect(first.source).toBe('fetch')
    expect(first.truncated).toBe(false)

    expect(second.url).toBe(url)
    expect(second.title).toBe(FIXTURE_TITLE)
    expect(second.summary).toBe(first.summary)
    expect(second.excerpt).toBe(first.excerpt)
    expect(second.contentType).toBe('text/html')
    expect(second.source).toBe('cache')
    expect(second.truncated).toBe(false)
    expect(second.fetchedAt).toBe(first.fetchedAt)
  })

  test('follows redirects and extracts content from the final URL', async () => {
    const redirectedUrl = `${baseUrl}${HTML_PATH}`

    const result = await fetchAndExtract(
      {
        storageContextId: 'ctx-1',
        url: `${baseUrl}${REDIRECT_PATH}`,
      },
      {
        safeFetchContent: (targetUrl: string, options?: { abortSignal?: AbortSignal }) =>
          safeFetchContent(targetUrl, options, { fetch, assertPublicUrl: async () => {} }),
      },
    )

    expect(result.url).toBe(redirectedUrl)
    expect(result.title).toBe(FIXTURE_TITLE)
    expect(result.summary).toContain(FIXTURE_BODY)
    expect(result.excerpt).toContain(FIXTURE_BODY)
    expect(result.contentType).toBe('text/html')
    expect(result.source).toBe('fetch')
    expect(result.truncated).toBe(false)
  })
})
