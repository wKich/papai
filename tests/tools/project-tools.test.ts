import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeArchiveProjectTool } from '../../src/tools/archive-project.js'
import { makeCreateProjectTool } from '../../src/tools/create-project.js'
import { makeListProjectsTool } from '../../src/tools/list-projects.js'
import { makeUpdateProjectTool } from '../../src/tools/update-project.js'
import { getToolExecutor } from '../test-helpers.js'

const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }
const mockWorkspaceId = 'ws-1'

interface ProjectItem {
  id: string
  name: string
  slug: string
}

function isProjectItem(item: unknown): item is ProjectItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    'id' in item &&
    typeof (item as Record<string, unknown>)['id'] === 'string' &&
    'name' in item &&
    typeof (item as Record<string, unknown>)['name'] === 'string' &&
    'slug' in item &&
    typeof (item as Record<string, unknown>)['slug'] === 'string'
  )
}

function isProjectArray(val: unknown): val is ProjectItem[] {
  return Array.isArray(val) && val.every(isProjectItem)
}

function isProject(val: unknown): val is ProjectItem {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof (val as Record<string, unknown>)['id'] === 'string' &&
    'name' in val &&
    typeof (val as Record<string, unknown>)['name'] === 'string' &&
    'slug' in val &&
    typeof (val as Record<string, unknown>)['slug'] === 'string'
  )
}

function isSuccessResult(val: unknown): val is { success: boolean } {
  return val !== null && typeof val === 'object' && 'success' in val && typeof val.success === 'boolean'
}

describe('Project Tools', () => {
  beforeEach(() => {
    mock.restore()
  })

  describe('makeListProjectsTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeListProjectsTool(mockConfig, mockWorkspaceId)
      expect(tool.description).toContain('List all available projects')
    })

    test('lists all projects in workspace', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listProjects: mock(() =>
          Promise.resolve([
            { id: 'proj-1', name: 'Project 1', slug: 'project-1' },
            { id: 'proj-2', name: 'Project 2', slug: 'project-2' },
          ]),
        ),
      }))

      const execute = getToolExecutor(makeListProjectsTool(mockConfig, mockWorkspaceId))
      const result: unknown = await execute({}, { toolCallId: '1', messages: [] })
      if (!isProjectArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(2)
      expect(result[0]!['name']).toBe('Project 1')
      expect(result[1]!['name']).toBe('Project 2')
    })

    test('returns empty array when no projects', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listProjects: mock(() => Promise.resolve([])),
      }))

      const execute = getToolExecutor(makeListProjectsTool(mockConfig, mockWorkspaceId))
      const result: unknown = await execute({}, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(0)
    })

    test('includes workspaceId in list call', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        listProjects: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve([])
        }),
      }))

      const execute = getToolExecutor(makeListProjectsTool(mockConfig, 'ws-123'))
      await execute({}, { toolCallId: '1', messages: [] })

      expect(capturedParams !== undefined && capturedParams['workspaceId']).toBe('ws-123')
    })

    test('propagates API errors', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        listProjects: mock(() => Promise.reject(new Error('API Error'))),
      }))

      const tool = makeListProjectsTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeCreateProjectTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeCreateProjectTool(mockConfig, mockWorkspaceId)
      expect(tool.description).toContain('Create a new project')
    })

    test('creates project with required name', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        createProject: mock(() =>
          Promise.resolve({
            id: 'proj-1',
            name: 'New Project',
            slug: 'new-project',
          }),
        ),
      }))

      const execute = getToolExecutor(makeCreateProjectTool(mockConfig, mockWorkspaceId))
      const result: unknown = await execute({ name: 'New Project' }, { toolCallId: '1', messages: [] })
      if (!isProject(result)) throw new Error('Invalid result')

      expect(result.id).toBe('proj-1')
      expect(result.name).toBe('New Project')
      expect(result.slug).toBe('new-project')
    })

    test('creates project with description', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        createProject: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            id: 'proj-1',
            name: String(params['name']),
            slug: 'new-project',
          })
        }),
      }))

      const execute = getToolExecutor(makeCreateProjectTool(mockConfig, mockWorkspaceId))
      await execute({ name: 'New Project', description: 'Project description' }, { toolCallId: '1', messages: [] })

      expect(capturedParams !== undefined && capturedParams['name']).toBe('New Project')
      expect(capturedParams !== undefined && capturedParams['description']).toBe('Project description')
    })

    test('includes workspaceId in create call', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        createProject: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({ id: 'proj-1', name: 'Test', slug: 'test' })
        }),
      }))

      const execute = getToolExecutor(makeCreateProjectTool(mockConfig, 'ws-123'))
      await execute({ name: 'Test' }, { toolCallId: '1', messages: [] })

      expect(capturedParams !== undefined && capturedParams['workspaceId']).toBe('ws-123')
    })

    test('propagates API errors', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        createProject: mock(() => Promise.reject(new Error('API Error'))),
      }))

      const tool = makeCreateProjectTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({ name: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates name is required', async () => {
      const tool = makeCreateProjectTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeUpdateProjectTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeUpdateProjectTool(mockConfig)
      expect(tool.description).toContain('Update an existing Kaneo project')
    })

    test('updates project name', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        updateProject: mock(() =>
          Promise.resolve({
            id: 'proj-1',
            name: 'Updated Name',
            slug: 'updated-name',
          }),
        ),
      }))

      const execute = getToolExecutor(makeUpdateProjectTool(mockConfig))
      const result: unknown = await execute(
        { projectId: 'proj-1', name: 'Updated Name' },
        { toolCallId: '1', messages: [] },
      )
      if (!isProject(result)) throw new Error('Invalid result')

      expect(result.id).toBe('proj-1')
      expect(result.name).toBe('Updated Name')
      expect(result.slug).toBe('updated-name')
    })

    test('updates project description', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        updateProject: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            id: 'proj-1',
            name: 'Test',
            slug: 'test',
          })
        }),
      }))

      const execute = getToolExecutor(makeUpdateProjectTool(mockConfig))
      await execute({ projectId: 'proj-1', description: 'New description' }, { toolCallId: '1', messages: [] })

      expect(capturedParams !== undefined && capturedParams['description']).toBe('New description')
    })

    test('updates both name and description', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        updateProject: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            id: 'proj-1',
            name: String(params['name']),
            slug: 'new-name',
          })
        }),
      }))

      const execute = getToolExecutor(makeUpdateProjectTool(mockConfig))
      await execute(
        { projectId: 'proj-1', name: 'New Name', description: 'New description' },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedParams !== undefined && capturedParams['name']).toBe('New Name')
      expect(capturedParams !== undefined && capturedParams['description']).toBe('New description')
    })

    test('propagates project not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        updateProject: mock(() => Promise.reject(new Error('Project not found'))),
      }))

      const tool = makeUpdateProjectTool(mockConfig)
      const promise = getToolExecutor(tool)({ projectId: 'invalid', name: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Project not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', async () => {
      const tool = makeUpdateProjectTool(mockConfig)
      const promise = getToolExecutor(tool)({ name: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates at least one field is provided', async () => {
      const tool = makeUpdateProjectTool(mockConfig)
      const promise = getToolExecutor(tool)({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeArchiveProjectTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeArchiveProjectTool(mockConfig)
      expect(tool.description).toContain('Archive (delete) a Kaneo project')
    })

    test('archives project successfully', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        archiveProject: mock(() => Promise.resolve({ success: true })),
      }))

      const execute = getToolExecutor(makeArchiveProjectTool(mockConfig))
      const result: unknown = await execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isSuccessResult(result)) throw new Error('Invalid result')

      expect(result.success).toBe(true)
    })

    test('propagates project not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        archiveProject: mock(() => Promise.reject(new Error('Project not found'))),
      }))

      const tool = makeArchiveProjectTool(mockConfig)
      const promise = getToolExecutor(tool)({ projectId: 'invalid' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Project not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', async () => {
      const tool = makeArchiveProjectTool(mockConfig)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })
})
