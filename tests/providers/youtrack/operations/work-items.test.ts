import { afterEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  createYouTrackWorkItem,
  deleteYouTrackWorkItem,
  listYouTrackWorkItems,
  updateYouTrackWorkItem,
} from '../../../../src/providers/youtrack/operations/work-items.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

mockLogger()

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

const installFetchMock = (handler: (url: string, init: RequestInit) => Promise<Response>): void => {
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
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const BodySchema = z.looseObject({})

const getLastFetchUrl = (): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getLastFetchBody = (): z.infer<typeof BodySchema> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const getLastFetchMethod = (): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const getFetchBodyAt = (index: number): z.infer<typeof BodySchema> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const makeWorkItemResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '8-1',
  date: 1700000000000,
  duration: { minutes: 90, presentation: '1h 30m' },
  text: 'Worked on feature',
  author: { id: '1-1', login: 'alice', name: 'Alice' },
  type: { id: '5-0', name: 'Development' },
  ...overrides,
})

afterEach(() => {
  restoreFetch()
})

// --- listYouTrackWorkItems ---

describe('listYouTrackWorkItems', () => {
  test('returns mapped work items from API', async () => {
    mockFetchResponse([makeWorkItemResponse()])
    const result = await listYouTrackWorkItems(config, 'PROJ-1')
    expect(result).toHaveLength(1)
    const wi = result[0]
    expect(wi?.id).toBe('8-1')
    expect(wi?.taskId).toBe('PROJ-1')
    expect(wi?.duration).toBe('PT1H30M')
    expect(wi?.description).toBe('Worked on feature')
    expect(wi?.author).toBe('alice')
    expect(wi?.type).toBe('Development')
  })

  test('normalises date to YYYY-MM-DD', async () => {
    mockFetchResponse([makeWorkItemResponse({ date: 1700000000000 })])
    const result = await listYouTrackWorkItems(config, 'PROJ-1')
    // 1700000000000ms = 2023-11-14
    expect(result[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('returns empty array when no work items', async () => {
    mockFetchResponse([])
    const result = await listYouTrackWorkItems(config, 'PROJ-1')
    expect(result).toHaveLength(0)
  })

  test('calls correct endpoint', async () => {
    mockFetchResponse([])
    await listYouTrackWorkItems(config, 'PROJ-42')
    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/PROJ-42/timeTracking/workItems')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404)
    await expect(listYouTrackWorkItems(config, 'PROJ-99')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

// --- createYouTrackWorkItem ---

describe('createYouTrackWorkItem', () => {
  test('creates work item and returns mapped result', async () => {
    mockFetchResponse(makeWorkItemResponse({ id: '8-2', duration: { minutes: 60, presentation: '1h' } }))
    const result = await createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h' })
    expect(result.id).toBe('8-2')
    expect(result.taskId).toBe('PROJ-1')
    expect(result.duration).toBe('PT1H')
  })

  test('parses natural duration strings in request', async () => {
    mockFetchResponse(makeWorkItemResponse())
    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '90m' })
    const body = getLastFetchBody()
    expect((body['duration'] as Record<string, unknown>)?.['minutes']).toBe(90)
  })

  test('parses "1.5h" duration in request', async () => {
    mockFetchResponse(makeWorkItemResponse())
    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '1.5h' })
    const body = getLastFetchBody()
    expect((body['duration'] as Record<string, unknown>)?.['minutes']).toBe(90)
  })

  test('includes description in request body', async () => {
    mockFetchResponse(makeWorkItemResponse({ text: 'Fixed bug' }))
    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '30m', description: 'Fixed bug' })
    const body = getLastFetchBody()
    expect(body['text']).toBe('Fixed bug')
  })

  test('includes date in request body when provided', async () => {
    mockFetchResponse(makeWorkItemResponse())
    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h', date: '2024-01-15' })
    const body = getLastFetchBody()
    expect(typeof body['date']).toBe('number')
  })

  test('uses the start of the current UTC day when not provided', async () => {
    mockFetchResponse(makeWorkItemResponse())
    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h' })
    const body = getLastFetchBody()
    const now = new Date()
    expect(body['date']).toBe(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  })

  test('calls correct endpoint with POST', async () => {
    mockFetchResponse(makeWorkItemResponse())
    await createYouTrackWorkItem(config, 'PROJ-3', { duration: '2h' })
    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/PROJ-3/timeTracking/workItems')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on 400', async () => {
    mockFetchError(400, { error: 'Invalid duration' })
    await expect(createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404)
    await expect(createYouTrackWorkItem(config, 'PROJ-99', { duration: '1h' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('uses a resolved stable work item type ID when type is already an ID', async () => {
    installFetchMock((url: string) => {
      const parsedUrl = new URL(url)
      if (parsedUrl.pathname.endsWith('/timeTrackingSettings/workItemTypes')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: '5-0', name: 'Development' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify(makeWorkItemResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    await createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h', type: '5-0' })

    expect(getFetchBodyAt(1)['type']).toEqual({ id: '5-0' })
  })

  test('rejects unknown work item types instead of falling back to a name payload', async () => {
    installFetchMock((url: string) => {
      const parsedUrl = new URL(url)
      if (parsedUrl.pathname.endsWith('/timeTrackingSettings/workItemTypes')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: '5-0', name: 'Development' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify(makeWorkItemResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    await expect(createYouTrackWorkItem(config, 'PROJ-1', { duration: '1h', type: 'Unknown' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
    expect(fetchMock.mock.calls).toHaveLength(1)
  })
})

// --- updateYouTrackWorkItem ---

describe('updateYouTrackWorkItem', () => {
  test('updates work item and returns mapped result', async () => {
    mockFetchResponse(makeWorkItemResponse({ duration: { minutes: 120, presentation: '2h' }, text: 'Updated' }))
    const result = await updateYouTrackWorkItem(config, 'PROJ-1', '8-1', { duration: '2h', description: 'Updated' })
    expect(result.id).toBe('8-1')
    expect(result.duration).toBe('PT2H')
    expect(result.description).toBe('Updated')
  })

  test('sends duration as minutes', async () => {
    mockFetchResponse(makeWorkItemResponse())
    await updateYouTrackWorkItem(config, 'PROJ-1', '8-1', { duration: '2h 30m' })
    const body = getLastFetchBody()
    expect((body['duration'] as Record<string, unknown>)?.['minutes']).toBe(150)
  })

  test('calls correct endpoint with POST', async () => {
    mockFetchResponse(makeWorkItemResponse())
    await updateYouTrackWorkItem(config, 'PROJ-5', '8-2', { duration: '1h' })
    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/PROJ-5/timeTracking/workItems/8-2')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('does not send duration if not provided', async () => {
    mockFetchResponse(makeWorkItemResponse())
    await updateYouTrackWorkItem(config, 'PROJ-1', '8-1', { description: 'Only text update' })
    const body = getLastFetchBody()
    expect(body['duration']).toBeUndefined()
    expect(body['text']).toBe('Only text update')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404)
    await expect(updateYouTrackWorkItem(config, 'PROJ-1', '8-999', { duration: '1h' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})

// --- deleteYouTrackWorkItem ---

describe('deleteYouTrackWorkItem', () => {
  test('returns the deleted work item id', async () => {
    mockFetchNoContent()
    const result = await deleteYouTrackWorkItem(config, 'PROJ-1', '8-5')
    expect(result.id).toBe('8-5')
  })

  test('calls correct endpoint with DELETE', async () => {
    mockFetchNoContent()
    await deleteYouTrackWorkItem(config, 'PROJ-3', '8-99')
    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/PROJ-3/timeTracking/workItems/8-99')
    expect(getLastFetchMethod()).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404)
    await expect(deleteYouTrackWorkItem(config, 'PROJ-1', '8-999')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on 403', async () => {
    mockFetchError(403)
    await expect(deleteYouTrackWorkItem(config, 'PROJ-1', '8-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})
