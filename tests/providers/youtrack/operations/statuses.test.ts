import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  createYouTrackStatus,
  deleteYouTrackStatus,
  listYouTrackStatuses,
  reorderYouTrackStatuses,
  updateYouTrackStatus,
} from '../../../../src/providers/youtrack/operations/statuses.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'
import { clearBundleCache } from '../test-helpers.js'

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

const mockFetchSequence = (responses: Array<{ data: unknown; status?: number }>): void => {
  let callIndex = 0
  installFetchMock(() => {
    const response = responses[callIndex]
    callIndex++
    if (response === undefined) {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    }
    return Promise.resolve(
      new Response(JSON.stringify(response.data), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
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

const getFetchCall = (index: number): [string, RequestInit] | null => {
  const call = fetchMock.mock.calls[index]
  if (!Array.isArray(call) || call.length < 2) return null
  const parsed = FetchCallSchema.safeParse(call)
  if (!parsed.success) return null
  return [parsed.data[0], parsed.data[1]]
}

const getLastFetchUrl = (): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getLastFetchBody = (): z.infer<typeof BodySchema> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const getLastFetchMethod = (): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const makeStateValue = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '57-1',
  name: 'Open',
  isResolved: false,
  ordinal: 0,
  $type: 'StateBundleElement',
  ...overrides,
})

const makeBundleInfo = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'bundle-123',
  aggregated: { project: [{ id: 'proj-1' }] },
  ...overrides,
})

const makeCustomField = (bundleId = 'bundle-123'): Record<string, unknown> => ({
  $type: 'StateProjectCustomField',
  field: { name: 'State' },
  bundle: { id: bundleId },
})

const extractResultMessage = (result: unknown): unknown => {
  if (result !== null && typeof result === 'object' && 'message' in result) {
    return (result as { message: unknown }).message
  }
  return undefined
}

const OrdinalBodySchema = z.looseObject({ ordinal: z.number() })

const assertOrdinalFromCall = (callIndex: number, expectedOrdinal: number): void => {
  const call = getFetchCall(callIndex)
  assert(call !== null, `Expected fetch call at index ${callIndex}`)
  const body = call[1].body
  assert(typeof body === 'string', `Expected body to be a string at call ${callIndex}`)
  const parsed = OrdinalBodySchema.parse(JSON.parse(body))
  expect(parsed.ordinal).toBe(expectedOrdinal)
}

const makePartialFailureReorderHandler = (): (() => Promise<Response>) => {
  let callIndex = 0
  return () => {
    callIndex++
    if (callIndex === 1) {
      return Promise.resolve(
        new Response(JSON.stringify([makeCustomField()]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (callIndex === 2) {
      return Promise.resolve(
        new Response(JSON.stringify(makeBundleInfo()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (callIndex === 3) {
      return Promise.resolve(
        new Response(JSON.stringify(makeStateValue({ id: '57-1', ordinal: 0 })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'Conflict' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }
}

const installNoPriorityStateFieldMock = (): void => {
  installFetchMock(() =>
    Promise.resolve(
      new Response(JSON.stringify([{ $type: 'CustomField', field: { name: 'Priority' } }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

describe('listYouTrackStatuses', () => {
  beforeEach(() => {
    mockLogger()
    clearBundleCache()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('lists states from state bundle', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { data: [makeStateValue(), makeStateValue({ id: '57-2', name: 'In Progress', ordinal: 1 })] },
    ])

    const statuses = await listYouTrackStatuses(config, 'proj-1')

    expect(statuses).toHaveLength(2)
    expect(statuses[0]!.id).toBe('57-1')
    expect(statuses[0]!.name).toBe('Open')
    expect(statuses[0]!.order).toBe(0)
    expect(statuses[1]!.name).toBe('In Progress')
  })

  test('returns isFinal as true when isResolved is true', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { data: [makeStateValue({ isResolved: true })] },
    ])

    const statuses = await listYouTrackStatuses(config, 'proj-1')

    expect(statuses[0]!.isFinal).toBe(true)
  })

  test('returns isFinal as false when isResolved is false', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { data: [makeStateValue({ isResolved: false })] },
    ])

    const statuses = await listYouTrackStatuses(config, 'proj-1')

    expect(statuses[0]!.isFinal).toBe(false)
  })

  test('uses correct API endpoints', async () => {
    mockFetchSequence([{ data: [makeCustomField()] }, { data: makeBundleInfo() }, { data: [makeStateValue()] }])

    await listYouTrackStatuses(config, 'proj-1')

    const calls = fetchMock.mock.calls
    expect(calls.length).toBe(3)

    const firstCall = getFetchCall(0)
    expect(firstCall).not.toBeNull()
    const firstUrl = new URL(firstCall![0])
    expect(firstUrl.pathname).toBe('/api/admin/projects/proj-1/customFields')

    const secondCall = getFetchCall(1)
    expect(secondCall).not.toBeNull()
    const secondUrl = new URL(secondCall![0])
    expect(secondUrl.pathname).toBe('/api/admin/customFieldSettings/bundles/state/bundle-123')

    const thirdCall = getFetchCall(2)
    expect(thirdCall).not.toBeNull()
    const thirdUrl = new URL(thirdCall![0])
    expect(thirdUrl.pathname).toBe('/api/admin/customFieldSettings/bundles/state/bundle-123/values')
  })

  test('returns empty array when no states', async () => {
    mockFetchSequence([{ data: [makeCustomField()] }, { data: makeBundleInfo() }, { data: [] }])

    const statuses = await listYouTrackStatuses(config, 'proj-1')

    expect(statuses).toEqual([])
  })

  test('throws classified error on API failure', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { status: 401, data: { error: 'Unauthorized' } },
    ])

    await expect(listYouTrackStatuses(config, 'proj-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on 404', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { status: 404, data: { error: 'Bundle not found' } },
    ])

    await expect(listYouTrackStatuses(config, 'proj-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('createYouTrackStatus', () => {
  beforeEach(() => {
    mockLogger()
    clearBundleCache()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('creates state in bundle and returns Column', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { data: makeStateValue({ id: '57-100', name: 'Ready', ordinal: 2 }) },
    ])

    const result = await createYouTrackStatus(config, 'proj-1', { name: 'Ready' })

    assert(!('status' in result), 'Should not require confirmation')
    expect(result.id).toBe('57-100')
    expect(result.name).toBe('Ready')
  })

  test('sends name in body', async () => {
    mockFetchSequence([{ data: [makeCustomField()] }, { data: makeBundleInfo() }, { data: makeStateValue() }])

    await createYouTrackStatus(config, 'proj-1', { name: 'New State' })

    const body = getLastFetchBody()
    expect(body['name']).toBe('New State')
  })

  test('sends isResolved when isFinal is true', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { data: makeStateValue({ isResolved: true }) },
    ])

    const result = await createYouTrackStatus(config, 'proj-1', { name: 'Done', isFinal: true })

    const body = getLastFetchBody()
    expect(body['isResolved']).toBe(true)
    assert(!('status' in result), 'Should not require confirmation')
    expect(result.isFinal).toBe(true)
  })

  test('sends isResolved when isFinal is false', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { data: makeStateValue({ isResolved: false }) },
    ])

    const result = await createYouTrackStatus(config, 'proj-1', { name: 'Open', isFinal: false })

    const body = getLastFetchBody()
    expect(body['isResolved']).toBe(false)
    assert(!('status' in result), 'Should not require confirmation')
    expect(result.isFinal).toBe(false)
  })

  test('uses POST method', async () => {
    mockFetchSequence([{ data: [makeCustomField()] }, { data: makeBundleInfo() }, { data: makeStateValue() }])

    await createYouTrackStatus(config, 'proj-1', { name: 'Test' })

    expect(getLastFetchMethod()).toBe('POST')
  })

  test('requires confirmation for shared bundles', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo({ aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } }) },
    ])

    const result = await createYouTrackStatus(config, 'proj-1', { name: 'New' }, false)

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(String(extractResultMessage(result))).toContain('shared')
  })

  test('proceeds when confirm=true for shared bundles', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo({ aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } }) },
      { data: makeStateValue() },
    ])

    const result = await createYouTrackStatus(config, 'proj-1', { name: 'New' }, true)

    assert(!('status' in result), 'Should not require confirmation')
    expect(result.id).toBe('57-1')
  })

  test('proceeds without confirm for non-shared bundles', async () => {
    mockFetchSequence([{ data: [makeCustomField()] }, { data: makeBundleInfo() }, { data: makeStateValue() }])

    const result = await createYouTrackStatus(config, 'proj-1', { name: 'New' })

    assert(!('status' in result), 'Should not require confirmation')
    expect(result.id).toBe('57-1')
  })

  test('throws classified error on API failure', async () => {
    mockFetchError(401)

    await expect(createYouTrackStatus(config, 'proj-1', { name: 'Test' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('throws not-found error when state bundle is missing', async () => {
    installNoPriorityStateFieldMock()

    const error = await createYouTrackStatus(config, 'proj-1', { name: 'Test' }).catch((e: unknown) => e)
    assert(error instanceof YouTrackClassifiedError)
    expect(error.appError.code).toBe('not-found')
  })
})

describe('updateYouTrackStatus', () => {
  beforeEach(() => {
    mockLogger()
    clearBundleCache()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('updates state name', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { data: makeStateValue({ name: 'Updated Name' }) },
    ])

    const result = await updateYouTrackStatus(config, 'proj-1', '57-1', { name: 'Updated Name' })

    assert(!('status' in result), 'Should not require confirmation')
    expect(result.name).toBe('Updated Name')
  })

  test('updates isFinal via isResolved', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { data: makeStateValue({ isResolved: true }) },
    ])

    const result = await updateYouTrackStatus(config, 'proj-1', '57-1', { isFinal: true })

    assert(!('status' in result), 'Should not require confirmation')
    expect(result.isFinal).toBe(true)
    const body = getLastFetchBody()
    expect(body['isResolved']).toBe(true)
  })

  test('sends only provided fields', async () => {
    mockFetchSequence([{ data: [makeCustomField()] }, { data: makeBundleInfo() }, { data: makeStateValue() }])

    await updateYouTrackStatus(config, 'proj-1', '57-1', { name: 'New' })

    const body = getLastFetchBody()
    expect(body['name']).toBe('New')
    expect(body['isResolved']).toBeUndefined()
  })

  test('uses POST method with status id in path', async () => {
    mockFetchSequence([{ data: [makeCustomField()] }, { data: makeBundleInfo() }, { data: makeStateValue() }])

    await updateYouTrackStatus(config, 'proj-1', '57-1', { name: 'X' })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/admin/customFieldSettings/bundles/state/bundle-123/values/57-1')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('requires confirmation for shared bundles', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo({ aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } }) },
    ])

    const result = await updateYouTrackStatus(config, 'proj-1', '57-1', { name: 'X' }, false)

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(String(extractResultMessage(result))).toContain('shared')
  })

  test('proceeds when confirm=true for shared bundles', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo({ aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } }) },
      { data: makeStateValue() },
    ])

    const result = await updateYouTrackStatus(config, 'proj-1', '57-1', { name: 'X' }, true)

    assert(!('status' in result), 'Should not require confirmation')
    expect(result.id).toBe('57-1')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'State not found' })

    await expect(updateYouTrackStatus(config, 'proj-1', '57-999', { name: 'X' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('throws not-found error when state bundle is missing', async () => {
    installNoPriorityStateFieldMock()

    const error = await updateYouTrackStatus(config, 'proj-1', '57-1', { name: 'Test' }).catch((e: unknown) => e)
    assert(error instanceof YouTrackClassifiedError)
    expect(error.appError.code).toBe('not-found')
  })
})

describe('deleteYouTrackStatus', () => {
  beforeEach(() => {
    mockLogger()
    clearBundleCache()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('deletes state from bundle', async () => {
    mockFetchSequence([{ data: [makeCustomField()] }, { data: makeBundleInfo() }, { data: {} }])

    const result = await deleteYouTrackStatus(config, 'proj-1', '57-1')

    assert(!('status' in result), 'Should not require confirmation')
    expect(result).toEqual({ id: '57-1' })
  })

  test('uses DELETE method', async () => {
    mockFetchSequence([{ data: [makeCustomField()] }, { data: makeBundleInfo() }, { data: {} }])

    await deleteYouTrackStatus(config, 'proj-1', '57-1')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/admin/customFieldSettings/bundles/state/bundle-123/values/57-1')
    expect(getLastFetchMethod()).toBe('DELETE')
  })

  test('requires confirmation for shared bundles', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo({ aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } }) },
    ])

    const result = await deleteYouTrackStatus(config, 'proj-1', '57-1', false)

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(String(extractResultMessage(result))).toContain('shared')
  })

  test('proceeds when confirm=true for shared bundles', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo({ aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } }) },
      { data: {} },
    ])

    const result = await deleteYouTrackStatus(config, 'proj-1', '57-1', true)

    assert(!('status' in result), 'Should not require confirmation')
    expect(result).toEqual({ id: '57-1' })
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'State not found' })

    await expect(deleteYouTrackStatus(config, 'proj-1', '57-999')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws not-found error when state bundle is missing', async () => {
    installNoPriorityStateFieldMock()

    const error = await deleteYouTrackStatus(config, 'proj-1', '57-1').catch((e: unknown) => e)
    assert(error instanceof YouTrackClassifiedError)
    expect(error.appError.code).toBe('not-found')
  })
})

describe('reorderYouTrackStatuses', () => {
  beforeEach(() => {
    mockLogger()
    clearBundleCache()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('updates ordinal for each status', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { data: makeStateValue({ id: '57-1', ordinal: 0 }) },
      { data: makeStateValue({ id: '57-2', ordinal: 1 }) },
    ])

    await reorderYouTrackStatuses(config, 'proj-1', [
      { id: '57-1', position: 0 },
      { id: '57-2', position: 1 },
    ])

    const calls = fetchMock.mock.calls
    expect(calls.length).toBe(4)

    const thirdCall = getFetchCall(2)
    expect(thirdCall).not.toBeNull()
    const thirdCallUrl = new URL(thirdCall![0])

    const fourthCall = getFetchCall(3)
    expect(fourthCall).not.toBeNull()
    const fourthCallUrl = new URL(fourthCall![0])

    expect(thirdCallUrl.pathname).toBe('/api/admin/customFieldSettings/bundles/state/bundle-123/values/57-1')
    expect(fourthCallUrl.pathname).toBe('/api/admin/customFieldSettings/bundles/state/bundle-123/values/57-2')
  })

  test('sends ordinal in body for each status', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { data: makeStateValue() },
      { data: makeStateValue() },
    ])

    await reorderYouTrackStatuses(config, 'proj-1', [
      { id: '57-1', position: 5 },
      { id: '57-2', position: 10 },
    ])

    assertOrdinalFromCall(2, 5)
    assertOrdinalFromCall(3, 10)
  })

  test('requires confirmation for shared bundles', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo({ aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } }) },
    ])

    const result = await reorderYouTrackStatuses(
      config,
      'proj-1',
      [
        { id: '57-1', position: 0 },
        { id: '57-2', position: 1 },
      ],
      false,
    )

    expect(result).toMatchObject({ status: 'confirmation_required' })
    expect(String(extractResultMessage(result))).toContain('shared')
  })

  test('proceeds when confirm=true for shared bundles', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo({ aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] } }) },
      { data: makeStateValue() },
      { data: makeStateValue() },
    ])

    await reorderYouTrackStatuses(
      config,
      'proj-1',
      [
        { id: '57-1', position: 0 },
        { id: '57-2', position: 1 },
      ],
      true,
    )

    expect(fetchMock.mock.calls.length).toBe(4)
  })

  test('returns void on success', async () => {
    mockFetchSequence([{ data: [makeCustomField()] }, { data: makeBundleInfo() }, { data: makeStateValue() }])

    const result = await reorderYouTrackStatuses(config, 'proj-1', [{ id: '57-1', position: 0 }])

    expect(result).toBeUndefined()
  })

  test('throws classified error on API failure', async () => {
    mockFetchSequence([
      { data: [makeCustomField()] },
      { data: makeBundleInfo() },
      { status: 401, data: { error: 'Unauthorized' } },
    ])

    await expect(reorderYouTrackStatuses(config, 'proj-1', [{ id: '57-1', position: 0 }])).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('throws error with details when some reorders fail', async () => {
    installFetchMock(makePartialFailureReorderHandler())

    const promise = reorderYouTrackStatuses(config, 'proj-1', [
      { id: '57-1', position: 0 },
      { id: '57-2', position: 1 },
    ])

    await expect(promise).rejects.toBeInstanceOf(YouTrackClassifiedError)
    // Error message should contain the failing status ID and partial failure context
    await expect(promise).rejects.toThrow('Failed to reorder 1 of 2 statuses: 57-2:')
  })
})
