import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import {
  addYouTrackTaskLabel,
  createYouTrackLabel,
  listYouTrackLabels,
  removeYouTrackLabel,
  removeYouTrackTaskLabel,
  updateYouTrackLabel,
} from '../../../src/providers/youtrack/labels.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

// --- Fetch mocking infrastructure ---

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

/** Install a fetch mock that returns different responses on successive calls. */
const mockFetchSequence = (responses: Array<{ data: unknown; status?: number }>): void => {
  let callIndex = 0
  const m = mock<(url: string, init: RequestInit) => Promise<Response>>(() => {
    const response = responses[callIndex] ?? responses[responses.length - 1]!
    callIndex++
    return Promise.resolve(
      new Response(JSON.stringify(response.data), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  fetchMock = m
  setMockFetch((url: string, init: RequestInit) => m(url, init))
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const BodySchema = z.looseObject({})

const getLastFetchUrl = (): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls.at(-1))
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getFetchUrl = (index: number): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getLastFetchBody = (): z.infer<typeof BodySchema> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls.at(-1))
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const getFetchBody = (index: number): z.infer<typeof BodySchema> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const getFetchMethod = (index: number): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const getLastFetchMethod = (): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls.at(-1))
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

// --- Fixtures ---

type TagFixture = Record<string, unknown>

const makeTagResponse = (overrides: Record<string, unknown> = {}): TagFixture => ({
  id: 'tag-1',
  name: 'bug',
  color: { id: 'c-1', background: '#ff0000' },
  ...overrides,
})

// --- Tests ---

beforeEach(() => {
  mockLogger()
})

describe('listYouTrackLabels', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns mapped labels', async () => {
    mockFetchResponse([
      makeTagResponse(),
      makeTagResponse({ id: 'tag-2', name: 'feature', color: { id: 'c-2', background: '#00ff00' } }),
    ])

    const labels = await listYouTrackLabels(config)

    expect(labels).toHaveLength(2)
    expect(labels[0]!.id).toBe('tag-1')
    expect(labels[0]!.name).toBe('bug')
    expect(labels[0]!.color).toBe('#ff0000')
    expect(labels[1]!.id).toBe('tag-2')
    expect(labels[1]!.name).toBe('feature')
    expect(labels[1]!.color).toBe('#00ff00')
  })

  test('maps color to undefined when color is null', async () => {
    mockFetchResponse([makeTagResponse({ color: null })])

    const labels = await listYouTrackLabels(config)

    expect(labels[0]!.color).toBeUndefined()
  })

  test('maps color to undefined when color field is absent', async () => {
    const tag = makeTagResponse()
    delete tag['color']
    mockFetchResponse([tag])

    const labels = await listYouTrackLabels(config)

    expect(labels[0]!.color).toBeUndefined()
  })

  test('returns empty array when no labels', async () => {
    mockFetchResponse([])

    const labels = await listYouTrackLabels(config)

    expect(labels).toEqual([])
  })

  test('uses GET method to /api/tags', async () => {
    mockFetchResponse([])

    await listYouTrackLabels(config)

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/tags')
    expect(url.searchParams.get('$top')).toBe('100')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500)

    await expect(listYouTrackLabels(config)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('createYouTrackLabel', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('creates label and returns mapped result', async () => {
    mockFetchResponse(makeTagResponse({ id: 'new-tag', name: 'urgent' }))

    const label = await createYouTrackLabel(config, { name: 'urgent' })

    expect(label.id).toBe('new-tag')
    expect(label.name).toBe('urgent')
    expect(label.color).toBe('#ff0000')
  })

  test('sends name in request body', async () => {
    mockFetchResponse(makeTagResponse())

    await createYouTrackLabel(config, { name: 'my-label' })

    const body = getLastFetchBody()
    expect(body['name']).toBe('my-label')
  })

  test('maps color from response when present', async () => {
    mockFetchResponse(makeTagResponse({ color: { id: 'c-1', background: '#0000ff' } }))

    const label = await createYouTrackLabel(config, { name: 'test' })

    expect(label.color).toBe('#0000ff')
  })

  test('maps color to undefined when null', async () => {
    mockFetchResponse(makeTagResponse({ color: null }))

    const label = await createYouTrackLabel(config, { name: 'test' })

    expect(label.color).toBeUndefined()
  })

  test('uses POST method to /api/tags', async () => {
    mockFetchResponse(makeTagResponse())

    await createYouTrackLabel(config, { name: 'test' })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/tags')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(400)

    await expect(createYouTrackLabel(config, { name: 'test' })).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('updateYouTrackLabel', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('updates label name and returns mapped result', async () => {
    mockFetchResponse(makeTagResponse({ name: 'updated-name' }))

    const label = await updateYouTrackLabel(config, 'tag-1', { name: 'updated-name' })

    expect(label.id).toBe('tag-1')
    expect(label.name).toBe('updated-name')
  })

  test('sends name in body when provided', async () => {
    mockFetchResponse(makeTagResponse())

    await updateYouTrackLabel(config, 'tag-1', { name: 'new-name' })

    const body = getLastFetchBody()
    expect(body['name']).toBe('new-name')
  })

  test('does not send name when absent', async () => {
    mockFetchResponse(makeTagResponse())

    await updateYouTrackLabel(config, 'tag-1', {})

    const body = getLastFetchBody()
    expect(body['name']).toBeUndefined()
  })

  test('uses POST method with label id in path', async () => {
    mockFetchResponse(makeTagResponse())

    await updateYouTrackLabel(config, 'tag-1', { name: 'x' })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/tags/tag-1')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Tag not found /tags/' })

    try {
      await updateYouTrackLabel(config, 'nonexistent', { name: 'x' })
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (error instanceof YouTrackClassifiedError) {
        expect(error.appError.code).toBe('label-not-found')
      }
    }
  })

  test('updateLabel sends color in request body', async () => {
    mockFetchResponse(
      makeTagResponse({ id: 'tag-123', name: 'Updated Tag', color: { id: 'color-1', background: '#FF5722' } }),
    )

    await updateYouTrackLabel(config, 'tag-123', { name: 'Updated Tag', color: '#FF5722' })

    const body = getLastFetchBody()
    expect(body['name']).toBe('Updated Tag')
    expect(body['color']).toEqual({ background: '#FF5722' })
  })
})

describe('removeYouTrackLabel', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('removes label and returns id', async () => {
    mockFetchNoContent()

    const result = await removeYouTrackLabel(config, 'tag-1')

    expect(result).toEqual({ id: 'tag-1' })
  })

  test('uses DELETE method with label id in path', async () => {
    mockFetchNoContent()

    await removeYouTrackLabel(config, 'tag-42')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/tags/tag-42')
    expect(getLastFetchMethod()).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Tag not found /tags/' })

    try {
      await removeYouTrackLabel(config, 'nonexistent')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (error instanceof YouTrackClassifiedError) {
        expect(error.appError.code).toBe('label-not-found')
      }
    }
  })
})

describe('addYouTrackTaskLabel', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('adds label to task and returns ids', async () => {
    mockFetchSequence([{ data: { id: 'issue-1', tags: [{ id: 'existing-tag' }] } }, { data: { id: 'issue-1' } }])

    const result = await addYouTrackTaskLabel(config, 'TEST-1', 'new-tag')

    expect(result).toEqual({ taskId: 'TEST-1', labelId: 'new-tag' })
  })

  test('first fetches current tags then sends updated list', async () => {
    mockFetchSequence([
      { data: { id: 'issue-1', tags: [{ id: 'tag-a' }, { id: 'tag-b' }] } },
      { data: { id: 'issue-1' } },
    ])

    await addYouTrackTaskLabel(config, 'TEST-1', 'tag-c')

    // First call: GET to fetch current tags
    const firstUrl = getFetchUrl(0)
    expect(firstUrl.pathname).toBe('/api/issues/TEST-1')
    expect(getFetchMethod(0)).toBe('GET')

    // Second call: POST to update tags
    const secondUrl = getFetchUrl(1)
    expect(secondUrl.pathname).toBe('/api/issues/TEST-1')
    expect(getFetchMethod(1)).toBe('POST')

    const body = getFetchBody(1)
    expect(body['tags']).toEqual([{ id: 'tag-a' }, { id: 'tag-b' }, { id: 'tag-c' }])
  })

  test('handles task with no existing tags', async () => {
    mockFetchSequence([{ data: { id: 'issue-1' } }, { data: { id: 'issue-1' } }])

    await addYouTrackTaskLabel(config, 'TEST-1', 'tag-1')

    const body = getFetchBody(1)
    expect(body['tags']).toEqual([{ id: 'tag-1' }])
  })

  test('handles task with empty tags array', async () => {
    mockFetchSequence([{ data: { id: 'issue-1', tags: [] } }, { data: { id: 'issue-1' } }])

    await addYouTrackTaskLabel(config, 'TEST-1', 'tag-1')

    const body = getFetchBody(1)
    expect(body['tags']).toEqual([{ id: 'tag-1' }])
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500)

    await expect(addYouTrackTaskLabel(config, 'TEST-1', 'tag-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('removeYouTrackTaskLabel', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('removes label from task and returns ids', async () => {
    mockFetchSequence([
      { data: { id: 'issue-1', tags: [{ id: 'tag-keep' }, { id: 'tag-remove' }] } },
      { data: { id: 'issue-1' } },
    ])

    const result = await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-remove')

    expect(result).toEqual({ taskId: 'TEST-1', labelId: 'tag-remove' })
  })

  test('filters out the specified tag and sends remaining', async () => {
    mockFetchSequence([
      { data: { id: 'issue-1', tags: [{ id: 'tag-a' }, { id: 'tag-b' }, { id: 'tag-c' }] } },
      { data: { id: 'issue-1' } },
    ])

    await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-b')

    const body = getFetchBody(1)
    expect(body['tags']).toEqual([{ id: 'tag-a' }, { id: 'tag-c' }])
  })

  test('sends empty tags when removing the only tag', async () => {
    mockFetchSequence([{ data: { id: 'issue-1', tags: [{ id: 'tag-only' }] } }, { data: { id: 'issue-1' } }])

    await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-only')

    const body = getFetchBody(1)
    expect(body['tags']).toEqual([])
  })

  test('handles task with no existing tags', async () => {
    mockFetchSequence([{ data: { id: 'issue-1' } }, { data: { id: 'issue-1' } }])

    await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-1')

    const body = getFetchBody(1)
    expect(body['tags']).toEqual([])
  })

  test('first fetches current tags then sends filtered list', async () => {
    mockFetchSequence([{ data: { id: 'issue-1', tags: [{ id: 'tag-1' }] } }, { data: { id: 'issue-1' } }])

    await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-1')

    // First call: GET
    expect(getFetchMethod(0)).toBe('GET')

    // Second call: POST with filtered tags
    expect(getFetchMethod(1)).toBe('POST')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500)

    await expect(removeYouTrackTaskLabel(config, 'TEST-1', 'tag-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})
