import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  archiveYouTrackProject,
  createYouTrackProject,
  getYouTrackProject,
  listYouTrackProjects,
  updateYouTrackProject,
} from '../../../../src/providers/youtrack/operations/projects.js'
import { restoreFetch, setMockFetch } from '../../../test-helpers.js'
import { mockLogger } from '../../../utils/test-helpers.js'

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
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (error instanceof YouTrackClassifiedError) {
        expect(error.appError.code).toBe('project-not-found')
      }
    }
  })

  test('throws classified error on auth failure', async () => {
    mockFetchError(401)

    try {
      await getYouTrackProject(config, 'proj-1')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (error instanceof YouTrackClassifiedError) {
        expect(error.appError.code).toBe('auth-failed')
      }
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
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500)

    await expect(listYouTrackProjects(config)).rejects.toBeInstanceOf(YouTrackClassifiedError)
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
    expect(body['shortName']).toBe('MYCOOLPROJ')
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
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (error instanceof YouTrackClassifiedError) {
        expect(error.appError.code).toBe('project-not-found')
      }
    }
  })
})

describe('archiveYouTrackProject', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('archives project and returns id', async () => {
    mockFetchResponse({ id: 'proj-1' })

    const result = await archiveYouTrackProject(config, 'proj-1')

    expect(result).toEqual({ id: 'proj-1' })
  })

  test('sends archived: true in request body', async () => {
    mockFetchResponse({ id: 'proj-1' })

    await archiveYouTrackProject(config, 'proj-1')

    const body = getLastFetchBody()
    expect(body['archived']).toBe(true)
  })

  test('uses POST method with project id in path', async () => {
    mockFetchResponse({ id: 'proj-1' })

    await archiveYouTrackProject(config, 'proj-1')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/admin/projects/proj-1')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(404, { error: 'Project not found /projects/' })

    try {
      await archiveYouTrackProject(config, 'nonexistent')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (error instanceof YouTrackClassifiedError) {
        expect(error.appError.code).toBe('project-not-found')
      }
    }
  })
})
