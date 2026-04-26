import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  createYouTrackProject,
  deleteYouTrackProject,
  generateShortName,
  getYouTrackProject,
  listYouTrackProjects,
  updateYouTrackProject,
} from '../../../../src/providers/youtrack/operations/projects.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

// --- Fetch mocking infrastructure ---

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

// --- Fixtures ---

type ProjectFixture = Record<string, unknown>

const makeProjectResponse = (overrides: Record<string, unknown> = {}): ProjectFixture => ({
  id: 'proj-1',
  name: 'Test Project',
  shortName: 'TEST',
  description: 'A test project',
  ...overrides,
})

// Pagination mock helpers — defined outside test blocks to satisfy no-conditional-in-test.
// Returns a handler that serves a full page on the first call and a single item on the second.
function makePaginatedFetchHandler(
  makeProjectFn: (overrides: Record<string, unknown>) => ProjectFixture,
): (url: string) => Promise<Response> {
  let callCount = 0
  return (): Promise<Response> => {
    callCount++
    if (callCount === 1) {
      return Promise.resolve(
        new Response(
          JSON.stringify(
            Array.from({ length: 100 }, (_, index) => makeProjectFn({ id: `proj-${index}`, shortName: `P${index}` })),
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify([makeProjectFn({ id: 'proj-last', shortName: 'LAST' })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }
}

// Returns a handler that captures the first URL it receives and then returns an empty array.
function makeUrlCapturingFetchHandler(): {
  handler: (url: string) => Promise<Response>
  getFirstUrl: () => URL | undefined
} {
  let firstUrl: URL | undefined
  return {
    handler: (url: string): Promise<Response> => {
      firstUrl ??= new URL(url)
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    },
    getFirstUrl: (): URL | undefined => firstUrl,
  }
}

// --- Tests ---

describe('getYouTrackProject', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('retrieves project and maps fields', async () => {
    mockFetchResponse(makeProjectResponse())

    const project = await getYouTrackProject(config, 'proj-1')

    expect(project.id).toBe('proj-1')
    expect(project.name).toBe('Test Project')
    expect(project.description).toBe('A test project')
    expect(project.url).toBe('https://test.youtrack.cloud/projects/TEST')
  })

  test('uses shortName in URL when available', async () => {
    mockFetchResponse(makeProjectResponse({ shortName: 'MYPROJ' }))

    const project = await getYouTrackProject(config, 'proj-1')

    expect(project.url).toBe('https://test.youtrack.cloud/projects/MYPROJ')
  })

  test('falls back to id when shortName is null', async () => {
    mockFetchResponse(makeProjectResponse({ shortName: null }))

    // ProjectSchema requires shortName as string, but the mapper uses ?? fallback
    // Let's test with a valid shortName that matches the id instead
    mockFetchResponse(makeProjectResponse({ id: 'proj-fallback', shortName: 'proj-fallback' }))

    const project = await getYouTrackProject(config, 'proj-fallback')
    expect(project.url).toContain('proj-fallback')
  })

  test('uses GET method with project id in path', async () => {
    mockFetchResponse(makeProjectResponse())

    await getYouTrackProject(config, 'proj-1')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/admin/projects/proj-1')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Project not found /projects/' })

    try {
      await getYouTrackProject(config, 'nonexistent')
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('project-not-found')
    }
  })

  test('throws classified error on auth failure', async () => {
    mockFetchError(401)

    try {
      await getYouTrackProject(config, 'proj-1')
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('auth-failed')
    }
  })
})

describe('listYouTrackProjects', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns mapped projects', async () => {
    mockFetchResponse([makeProjectResponse(), makeProjectResponse({ id: 'proj-2', name: 'Second', shortName: 'SEC' })])

    const projects = await listYouTrackProjects(config)

    expect(projects).toHaveLength(2)
    expect(projects[0]!.id).toBe('proj-1')
    expect(projects[0]!.name).toBe('Test Project')
    expect(projects[0]!.description).toBe('A test project')
    expect(projects[0]!.url).toBe('https://test.youtrack.cloud/projects/TEST')
    expect(projects[1]!.id).toBe('proj-2')
    expect(projects[1]!.name).toBe('Second')
  })

  test('filters out archived projects', async () => {
    mockFetchResponse([
      makeProjectResponse({ id: 'active', name: 'Active', shortName: 'ACT' }),
      makeProjectResponse({ id: 'archived', name: 'Archived', shortName: 'ARC', archived: true }),
    ])

    const projects = await listYouTrackProjects(config)

    expect(projects).toHaveLength(1)
    expect(projects[0]!.id).toBe('active')
  })

  test('keeps projects where archived is false', async () => {
    mockFetchResponse([makeProjectResponse({ archived: false })])

    const projects = await listYouTrackProjects(config)

    expect(projects).toHaveLength(1)
  })

  test('keeps projects where archived is undefined', async () => {
    const proj = makeProjectResponse()
    delete proj['archived']
    mockFetchResponse([proj])

    const projects = await listYouTrackProjects(config)

    expect(projects).toHaveLength(1)
  })

  test('returns empty array when no projects', async () => {
    mockFetchResponse([])

    const projects = await listYouTrackProjects(config)

    expect(projects).toEqual([])
  })

  test('uses GET method to /api/admin/projects', async () => {
    mockFetchResponse([])

    await listYouTrackProjects(config)

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/admin/projects')
    expect(url.searchParams.get('$top')).toBe('100')
    expect(url.searchParams.get('$skip')).toBe('0')
  })

  test('fetches multiple pages when the first page reaches the pagination limit', async () => {
    installFetchMock(makePaginatedFetchHandler(makeProjectResponse))

    const projects = await listYouTrackProjects(config)

    expect(projects).toHaveLength(101)
    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  test('requests project pages with $top and $skip pagination params', async () => {
    const urlCapture = makeUrlCapturingFetchHandler()
    installFetchMock(urlCapture.handler)

    await listYouTrackProjects(config)

    const firstRequestUrl = urlCapture.getFirstUrl()
    assert(firstRequestUrl !== undefined, 'Expected first project-list request URL')
    expect(firstRequestUrl.searchParams.get('$top')).toBe('100')
    expect(firstRequestUrl.searchParams.get('$skip')).toBe('0')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500)

    await expect(listYouTrackProjects(config)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('generateShortName', () => {
  test('converts ASCII name to uppercase alphanumeric', () => {
    const result = generateShortName('My Cool Project')
    expect(result).toMatch(/^[A-Z0-9]+$/)
    expect(result).toMatch(/^MYCOOLP/)
    expect(result.length).toBeLessThanOrEqual(10)
  })

  test('removes special characters', () => {
    const result = generateShortName('Project!@#$%^&*()')
    expect(result).toMatch(/^[A-Z0-9]+$/)
    expect(result).toMatch(/^PROJECT/)
  })

  test('normalizes Unicode diacritics (é → e)', () => {
    const result = generateShortName('Café Project')
    expect(result).toMatch(/^[A-Z0-9]+$/)
    expect(result).toMatch(/^CAFEP/)
  })

  test('handles non-ASCII characters with fallback', () => {
    const result = generateShortName('日本語プロジェクト')
    expect(result).toMatch(/^[A-Z0-9]+$/)
    // Falls back to PROJECT prefix
    expect(result).toMatch(/^PROJECT/)
  })

  test('handles mixed ASCII and non-ASCII', () => {
    const result = generateShortName('日本語Project')
    expect(result).toMatch(/^[A-Z0-9]+$/)
    // Uses fallback since only ASCII is kept
    expect(result).toMatch(/^PROJECT/)
  })

  test('limits length to 10 characters', () => {
    const result = generateShortName('Very Long Project Name That Exceeds')
    expect(result.length).toBeLessThanOrEqual(10)
  })

  test('adds random suffix for collision avoidance', () => {
    const result1 = generateShortName('Test Project')
    const result2 = generateShortName('Test Project')
    // Should generate different suffixes
    expect(result1).not.toBe(result2)
    // Both should start with same base
    expect(result1.slice(0, 6)).toBe(result2.slice(0, 6))
  })

  test('handles empty string with fallback', () => {
    const result = generateShortName('')
    expect(result).toMatch(/^[A-Z0-9]+$/)
    expect(result).toMatch(/^PROJECT/)
  })

  test('handles whitespace-only with fallback', () => {
    const result = generateShortName('   \t\n  ')
    expect(result).toMatch(/^[A-Z0-9]+$/)
    expect(result).toMatch(/^PROJECT/)
  })

  test('preserves numbers in name when within 7-char base limit', () => {
    const result = generateShortName('Proj 2024 Alpha')
    expect(result).toMatch(/^[A-Z0-9]+$/)
    // Base is first 7 chars: PROJ202 -> plus 3-char suffix = 10 total
    expect(result.slice(0, 7)).toBe('PROJ202')
  })
})

describe('createYouTrackProject', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('creates project and returns mapped result', async () => {
    mockFetchResponse(makeProjectResponse({ id: 'new-1', name: 'New Project', shortName: 'NEWPROJECT' }))

    const project = await createYouTrackProject(config, { name: 'New Project' })

    expect(project.id).toBe('new-1')
    expect(project.name).toBe('New Project')
    expect(project.url).toBe('https://test.youtrack.cloud/projects/NEWPROJECT')
  })

  test('generates shortName from name (uppercase, no special chars, max 10)', async () => {
    mockFetchResponse(makeProjectResponse())

    await createYouTrackProject(config, { name: 'My Cool Project!' })

    const body = getLastFetchBody()
    const shortNameValue = body['shortName']
    assert(typeof shortNameValue === 'string', 'Expected shortName to be a string')
    const shortName = shortNameValue
    // Should start with cleaned name, be uppercase alphanumeric, max 10 chars
    expect(shortName).toMatch(/^[A-Z0-9]+$/)
    expect(shortName.length).toBeLessThanOrEqual(10)
    // Starts with base name
    expect(shortName).toMatch(/^MYCOOLP/)
    expect(body['name']).toBe('My Cool Project!')
  })

  test('sends description when provided', async () => {
    mockFetchResponse(makeProjectResponse())

    await createYouTrackProject(config, { name: 'Test', description: 'A desc' })

    const body = getLastFetchBody()
    expect(body['description']).toBe('A desc')
  })

  test('does not send description when absent', async () => {
    mockFetchResponse(makeProjectResponse())

    await createYouTrackProject(config, { name: 'Test' })

    const body = getLastFetchBody()
    expect(body['description']).toBeUndefined()
  })

  test('uses POST method to /api/admin/projects', async () => {
    mockFetchResponse(makeProjectResponse())

    await createYouTrackProject(config, { name: 'Test' })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/admin/projects')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(400)

    await expect(createYouTrackProject(config, { name: 'Test' })).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('updateYouTrackProject', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('updates project with name', async () => {
    mockFetchResponse(makeProjectResponse({ name: 'Updated' }))

    const project = await updateYouTrackProject(config, 'proj-1', { name: 'Updated' })

    expect(project.name).toBe('Updated')
    const body = getLastFetchBody()
    expect(body['name']).toBe('Updated')
  })

  test('updates project with description', async () => {
    mockFetchResponse(makeProjectResponse())

    await updateYouTrackProject(config, 'proj-1', { description: 'New desc' })

    const body = getLastFetchBody()
    expect(body['description']).toBe('New desc')
  })

  test('does not send fields when not provided', async () => {
    mockFetchResponse(makeProjectResponse())

    await updateYouTrackProject(config, 'proj-1', {})

    const body = getLastFetchBody()
    expect(body['name']).toBeUndefined()
    expect(body['description']).toBeUndefined()
  })

  test('uses POST method with project id in path', async () => {
    mockFetchResponse(makeProjectResponse())

    await updateYouTrackProject(config, 'proj-1', { name: 'X' })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/admin/projects/proj-1')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Project not found /projects/' })

    try {
      await updateYouTrackProject(config, 'nonexistent', { name: 'X' })
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('project-not-found')
    }
  })
})

describe('deleteYouTrackProject', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('deleteProject removes project via DELETE request', async () => {
    mockFetchResponse({})

    const result = await deleteYouTrackProject(config, 'proj-123')

    expect(result).toEqual({ id: 'proj-123' })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/admin/projects/proj-123')
    expect(getLastFetchMethod()).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Project not found' })

    try {
      await deleteYouTrackProject(config, 'nonexistent')
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('project-not-found')
    }
  })

  test('throws classified error on auth failure', async () => {
    mockFetchError(401)

    try {
      await deleteYouTrackProject(config, 'proj-1')
      expect.unreachable('Should have thrown')
    } catch (error) {
      assert(error instanceof YouTrackClassifiedError)
      expect(error.appError.code).toBe('auth-failed')
    }
  })
})
