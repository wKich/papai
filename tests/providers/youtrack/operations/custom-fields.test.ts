import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import { getProjectRequiredFields } from '../../../../src/providers/youtrack/operations/custom-fields.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

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

const mockFetchError = (status: number, body: unknown = { error: 'Something went wrong' }): void => {
  installFetchMock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

// --- Tests ---

beforeEach(() => {
  mockLogger()
})

describe('getProjectRequiredFields', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns required fields when canBeEmpty is false', async () => {
    mockFetchResponse([
      {
        id: '82-10',
        $type: 'EnumProjectCustomField',
        field: { id: '58-2', name: 'Type', $type: 'CustomField' },
        canBeEmpty: false,
        isPublic: true,
      },
      {
        id: '82-11',
        $type: 'StateProjectCustomField',
        field: { id: '58-3', name: 'State', $type: 'CustomField' },
        canBeEmpty: false,
        isPublic: true,
      },
      {
        id: '82-9',
        $type: 'EnumProjectCustomField',
        field: { id: '58-1', name: 'Priority', $type: 'CustomField' },
        canBeEmpty: true,
        isPublic: true,
      },
    ])

    const requiredFields = await getProjectRequiredFields(config, 'TEST')

    expect(requiredFields).toEqual(['Type', 'State'])
  })

  test('returns empty array when no required fields', async () => {
    mockFetchResponse([
      {
        id: '82-9',
        $type: 'EnumProjectCustomField',
        field: { id: '58-1', name: 'Priority', $type: 'CustomField' },
        canBeEmpty: true,
        isPublic: true,
      },
      {
        id: '84-111',
        $type: 'UserProjectCustomField',
        field: { id: '58-4', name: 'Assignee', $type: 'CustomField' },
        canBeEmpty: true,
        isPublic: true,
      },
    ])

    const requiredFields = await getProjectRequiredFields(config, 'TEST')

    expect(requiredFields).toEqual([])
  })

  test('makes request to correct endpoint', async () => {
    mockFetchResponse([])

    await getProjectRequiredFields(config, 'MYPROJECT')

    const lastCall = fetchMock.mock.calls[0]
    expect(lastCall).toBeDefined()
    if (lastCall === undefined) return

    const [url] = lastCall as [string, RequestInit]
    const urlObj = new URL(url)
    expect(urlObj.pathname).toBe('/api/admin/projects/MYPROJECT/customFields')
    expect(urlObj.searchParams.get('fields')).toContain('field(name)')
    expect(urlObj.searchParams.get('fields')).toContain('canBeEmpty')
  })

  test('throws YouTrackClassifiedError on API error', async () => {
    mockFetchError(404, { error: 'Project not found' })

    await expect(getProjectRequiredFields(config, 'NONEXISTENT')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws YouTrackClassifiedError on auth error', async () => {
    mockFetchError(401, { error: 'Unauthorized' })

    try {
      await getProjectRequiredFields(config, 'TEST')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (!(error instanceof YouTrackClassifiedError)) throw error
      expect(error.appError.code).toBe('auth-failed')
    }
  })
})
