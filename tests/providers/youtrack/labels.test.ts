import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import {
  addYouTrackTaskLabel,
  createYouTrackLabel,
  findYouTrackLabelsByName,
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

  test('sends color in request body when provided', async () => {
    mockFetchResponse(
      makeTagResponse({ id: 'tag-123', name: 'Colored Tag', color: { id: 'color-1', background: '#FF5722' } }),
    )

    await createYouTrackLabel(config, { name: 'Colored Tag', color: '#FF5722' })

    const body = getLastFetchBody()
    expect(body['name']).toBe('Colored Tag')
    expect(body['color']).toEqual({ background: '#FF5722' })
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

describe('findYouTrackLabelsByName', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('queries tags by name and returns exact visible matches', async () => {
    mockFetchResponse([
      makeTagResponse({ id: 'tag-1', name: 'blocked' }),
      makeTagResponse({ id: 'tag-2', name: 'blocked' }),
      makeTagResponse({ id: 'tag-3', name: 'blocking' }),
    ])

    const result = await findYouTrackLabelsByName(config, 'blocked')

    expect(result).toEqual([
      { id: 'tag-1', name: 'blocked', color: '#ff0000' },
      { id: 'tag-2', name: 'blocked', color: '#ff0000' },
    ])
  })

  test('sends the tag name as the server-side query parameter', async () => {
    mockFetchResponse([])

    await findYouTrackLabelsByName(config, 'blocked')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/tags')
    expect(url.searchParams.get('query')).toBe('blocked')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('paginates through tag results when exact match is not on the first page', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              Array.from({ length: 100 }, (_, index) =>
                makeTagResponse({ id: `tag-${index}`, name: `other-${index}` }),
              ),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify([makeTagResponse({ id: 'tag-101', name: 'blocked' })]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    const result = await findYouTrackLabelsByName(config, 'blocked')

    expect(result).toEqual([{ id: 'tag-101', name: 'blocked', color: '#ff0000' }])
    expect(getFetchUrl(0).searchParams.get('$top')).toBe('100')
    expect(getFetchUrl(1).searchParams.get('$skip')).toBe('100')
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
    mockFetchResponse({ id: 'new-tag', name: 'blocked' })

    const result = await addYouTrackTaskLabel(config, 'TEST-1', 'new-tag')

    expect(result).toEqual({ taskId: 'TEST-1', labelId: 'new-tag' })
  })

  test('uses direct issue tag endpoint with POST body containing the tag id', async () => {
    mockFetchResponse({ id: 'tag-c', name: 'blocked' })

    await addYouTrackTaskLabel(config, 'TEST-1', 'tag-c')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = getFetchUrl(0)
    expect(url.pathname).toBe('/api/issues/TEST-1/tags')
    expect(getFetchMethod(0)).toBe('POST')

    const body = getFetchBody(0)
    expect(body).toEqual({ id: 'tag-c' })
  })

  test('does not fetch the full current tag list before adding', async () => {
    mockFetchResponse({ id: 'tag-1', name: 'blocked' })

    await addYouTrackTaskLabel(config, 'TEST-1', 'tag-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
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
    mockFetchNoContent()

    const result = await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-remove')

    expect(result).toEqual({ taskId: 'TEST-1', labelId: 'tag-remove' })
  })

  test('uses direct issue tag endpoint with DELETE and tag id in path', async () => {
    mockFetchNoContent()

    await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-b')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = getFetchUrl(0)
    expect(url.pathname).toBe('/api/issues/TEST-1/tags/tag-b')
    expect(getFetchMethod(0)).toBe('DELETE')
  })

  test('does not fetch the full current tag list before removing', async () => {
    mockFetchNoContent()

    await removeYouTrackTaskLabel(config, 'TEST-1', 'tag-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500)

    await expect(removeYouTrackTaskLabel(config, 'TEST-1', 'tag-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})
