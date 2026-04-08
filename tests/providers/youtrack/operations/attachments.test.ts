import { afterEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  deleteYouTrackAttachment,
  listYouTrackAttachments,
  uploadYouTrackAttachment,
} from '../../../../src/providers/youtrack/operations/attachments.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

mockLogger()

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

const installFetchMock = (handler: () => Promise<Response>): void => {
  const m = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = m
  setMockFetch((url: string, init: RequestInit) => m(url, init))
}

const mockFetchResponse = (data: unknown, status = 200): void => {
  installFetchMock(() =>
    Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

const mockFetchNoContent = (): void => {
  installFetchMock(() => Promise.resolve(new Response(null, { status: 204 })))
}

const mockFetchError = (status: number, body: unknown = { error: 'Something went wrong' }): void => {
  installFetchMock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.unknown().optional() }),
])

const getLastFetchUrl = (): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getLastFetchMethod = (): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const makeAttachmentResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '0-10',
  name: 'screenshot.png',
  mimeType: 'image/png',
  size: 2048,
  url: 'https://test.youtrack.cloud/api/files/0-10',
  thumbnailURL: 'https://test.youtrack.cloud/api/files/0-10?thumb',
  author: { login: 'bob' },
  created: 1700000000000,
  ...overrides,
})

afterEach(() => {
  restoreFetch()
})

// --- listYouTrackAttachments ---

describe('listYouTrackAttachments', () => {
  test('returns mapped attachments from API', async () => {
    mockFetchResponse([makeAttachmentResponse()])
    const result = await listYouTrackAttachments(config, 'PROJ-1')
    expect(result).toHaveLength(1)
    const att = result[0]
    expect(att?.id).toBe('0-10')
    expect(att?.name).toBe('screenshot.png')
    expect(att?.mimeType).toBe('image/png')
    expect(att?.size).toBe(2048)
    expect(att?.url).toBe('https://test.youtrack.cloud/api/files/0-10')
    expect(att?.thumbnailUrl).toBe('https://test.youtrack.cloud/api/files/0-10?thumb')
    expect(att?.author).toBe('bob')
    expect(att?.createdAt).toBe('2023-11-14T22:13:20.000Z')
  })

  test('returns empty array when no attachments', async () => {
    mockFetchResponse([])
    const result = await listYouTrackAttachments(config, 'PROJ-1')
    expect(result).toHaveLength(0)
  })

  test('calls correct endpoint', async () => {
    mockFetchResponse([])
    await listYouTrackAttachments(config, 'PROJ-42')
    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/PROJ-42/attachments')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404)
    await expect(listYouTrackAttachments(config, 'PROJ-99')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on 401', async () => {
    mockFetchError(401)
    await expect(listYouTrackAttachments(config, 'PROJ-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

// --- uploadYouTrackAttachment ---

describe('uploadYouTrackAttachment', () => {
  test('uploads file and returns mapped attachment', async () => {
    mockFetchResponse([makeAttachmentResponse({ id: '0-20', name: 'report.pdf', mimeType: 'application/pdf' })])
    const file = {
      name: 'report.pdf',
      content: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
    }
    const result = await uploadYouTrackAttachment(config, 'PROJ-1', file)
    expect(result.id).toBe('0-20')
    expect(result.name).toBe('report.pdf')
    expect(result.mimeType).toBe('application/pdf')
  })

  test('calls correct endpoint with POST', async () => {
    mockFetchResponse([makeAttachmentResponse()])
    const file = { name: 'file.txt', content: new Uint8Array([72, 101, 108, 108, 111]) }
    await uploadYouTrackAttachment(config, 'PROJ-5', file)
    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/PROJ-5/attachments')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('sends multipart form data', async () => {
    let capturedRequest: RequestInit | undefined
    installFetchMock(() => {
      return Promise.resolve(
        new Response(JSON.stringify([makeAttachmentResponse()]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    // Capture request init via a custom handler
    const m = mock<(url: string, init: RequestInit) => Promise<Response>>((_url, init) => {
      capturedRequest = init
      return Promise.resolve(
        new Response(JSON.stringify([makeAttachmentResponse()]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    setMockFetch((url: string, init: RequestInit) => m(url, init))

    const file = { name: 'data.csv', content: new Uint8Array([1, 2, 3]) }
    await uploadYouTrackAttachment(config, 'PROJ-1', file)
    expect(capturedRequest?.body).toBeInstanceOf(FormData)
  })

  test('throws classified error on 401', async () => {
    mockFetchError(401)
    const file = { name: 'f.txt', content: new Uint8Array([]) }
    await expect(uploadYouTrackAttachment(config, 'PROJ-1', file)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on 400', async () => {
    mockFetchError(400, { error: 'Bad Request' })
    const file = { name: 'f.txt', content: new Uint8Array([]) }
    await expect(uploadYouTrackAttachment(config, 'PROJ-1', file)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

// --- deleteYouTrackAttachment ---

describe('deleteYouTrackAttachment', () => {
  test('returns the deleted attachment id', async () => {
    mockFetchNoContent()
    const result = await deleteYouTrackAttachment(config, 'PROJ-1', '0-10')
    expect(result.id).toBe('0-10')
  })

  test('calls correct endpoint with DELETE', async () => {
    mockFetchNoContent()
    await deleteYouTrackAttachment(config, 'PROJ-3', '0-99')
    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/PROJ-3/attachments/0-99')
    expect(getLastFetchMethod()).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404)
    await expect(deleteYouTrackAttachment(config, 'PROJ-1', '0-999')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on 403', async () => {
    mockFetchError(403)
    await expect(deleteYouTrackAttachment(config, 'PROJ-1', '0-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})
