import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

import { makeArchiveProjectTool } from '../../src/tools/archive-project.js'
import { makeCreateProjectTool } from '../../src/tools/create-project.js'
import { makeListProjectsTool } from '../../src/tools/list-projects.js'
import { makeUpdateProjectTool } from '../../src/tools/update-project.js'
import { getToolExecutor, schemaValidates } from '../test-helpers.js'
import { createMockProvider } from './mock-provider.js'

interface Project {
  id: string
  name: string
  description?: string
  url?: string
}

function isProject(val: unknown): val is Project {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof (val as Record<string, unknown>)['id'] === 'string' &&
    'name' in val &&
    typeof (val as Record<string, unknown>)['name'] === 'string'
  )
}

function isProjectArray(val: unknown): val is Project[] {
  return Array.isArray(val) && val.every(isProject)
}

describe('Project Tools', () => {
  beforeEach(() => {
    mock.restore()
  })

  describe('makeListProjectsTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeListProjectsTool(provider)
      expect(tool.description).toContain('List all available projects')
    })

    test('lists all projects in workspace', async () => {
      const provider = createMockProvider({
        listProjects: mock(() =>
          Promise.resolve([
            { id: 'proj-1', name: 'Project 1', url: 'https://test.com/project/1' },
            { id: 'proj-2', name: 'Project 2', url: 'https://test.com/project/2' },
          ]),
        ),
      })

      const tool = makeListProjectsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })
      if (!isProjectArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(2)
      expect(result[0]!['name']).toBe('Project 1')
      expect(result[1]!['name']).toBe('Project 2')
    })

    test('returns empty array when no projects', async () => {
      const provider = createMockProvider({
        listProjects: mock(() => Promise.resolve([])),
      })

      const tool = makeListProjectsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({}, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(0)
    })

    test('calls provider listProjects', async () => {
      const listProjects = mock(() => Promise.resolve([]))
      const provider = createMockProvider({ listProjects })

      const tool = makeListProjectsTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({}, { toolCallId: '1', messages: [] })

      expect(listProjects).toHaveBeenCalledTimes(1)
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        listProjects: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeListProjectsTool(provider)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeCreateProjectTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeCreateProjectTool(provider)
      expect(tool.description).toContain('Create a new project')
    })

    test('creates project with required name', async () => {
      const provider = createMockProvider({
        createProject: mock(() =>
          Promise.resolve({
            id: 'proj-1',
            name: 'New Project',
            url: 'https://test.com/project/1',
          }),
        ),
      })

      const tool = makeCreateProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ name: 'New Project' }, { toolCallId: '1', messages: [] })
      if (!isProject(result)) throw new Error('Invalid result')

      expect(result.id).toBe('proj-1')
      expect(result.name).toBe('New Project')
    })

    test('creates project with description', async () => {
      const createProject = mock((params: { name: string; description?: string }) =>
        Promise.resolve({
          id: 'proj-1',
          name: params.name,
          description: params.description,
          url: 'https://test.com/project/1',
        }),
      )
      const provider = createMockProvider({ createProject })

      const tool = makeCreateProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ name: 'New Project', description: 'Project description' }, { toolCallId: '1', messages: [] })

      expect(createProject).toHaveBeenCalledWith({ name: 'New Project', description: 'Project description' })
    })

    test('passes undefined description when not provided', async () => {
      const createProject = mock((params: { name: string; description?: string }) =>
        Promise.resolve({
          id: 'proj-1',
          name: params.name,
          url: 'https://test.com/project/1',
        }),
      )
      const provider = createMockProvider({ createProject })

      const tool = makeCreateProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ name: 'Test' }, { toolCallId: '1', messages: [] })

      expect(createProject).toHaveBeenCalledWith({ name: 'Test', description: undefined })
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        createProject: mock(() => Promise.reject(new Error('API Error'))),
      })

      const tool = makeCreateProjectTool(provider)
      const promise = getToolExecutor(tool)({ name: 'Test' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('API Error')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates name is required', () => {
      const provider = createMockProvider()
      const tool = makeCreateProjectTool(provider)
      expect(schemaValidates(tool, {})).toBe(false)
    })
  })

  describe('makeUpdateProjectTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeUpdateProjectTool(provider)
      expect(tool.description).toContain('Update an existing project')
    })

    test('updates project name', async () => {
      const provider = createMockProvider({
        updateProject: mock(() =>
          Promise.resolve({
            id: 'proj-1',
            name: 'Updated Name',
            url: 'https://test.com/project/1',
          }),
        ),
      })

      const tool = makeUpdateProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { projectId: 'proj-1', name: 'Updated Name' },
        { toolCallId: '1', messages: [] },
      )
      if (!isProject(result)) throw new Error('Invalid result')

      expect(result.id).toBe('proj-1')
      expect(result.name).toBe('Updated Name')
    })

    test('updates project description', async () => {
      const updateProject = mock((_projectId: string, params: { name?: string; description?: string }) =>
        Promise.resolve({
          id: 'proj-1',
          name: 'Test',
          description: params.description,
          url: 'https://test.com/project/1',
        }),
      )
      const provider = createMockProvider({ updateProject })

      const tool = makeUpdateProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ projectId: 'proj-1', description: 'New description' }, { toolCallId: '1', messages: [] })

      expect(updateProject).toHaveBeenCalledWith('proj-1', { name: undefined, description: 'New description' })
    })

    test('updates both name and description', async () => {
      const updateProject = mock((_projectId: string, params: { name?: string; description?: string }) =>
        Promise.resolve({
          id: 'proj-1',
          name: params.name ?? 'Test',
          description: params.description,
          url: 'https://test.com/project/1',
        }),
      )
      const provider = createMockProvider({ updateProject })

      const tool = makeUpdateProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute(
        { projectId: 'proj-1', name: 'New Name', description: 'New description' },
        { toolCallId: '1', messages: [] },
      )

      expect(updateProject).toHaveBeenCalledWith('proj-1', { name: 'New Name', description: 'New description' })
    })

    test('propagates project not found error', async () => {
      const provider = createMockProvider({
        updateProject: mock(() => Promise.reject(new Error('Project not found'))),
      })

      const tool = makeUpdateProjectTool(provider)
      const promise = getToolExecutor(tool)({ projectId: 'invalid', name: 'Test' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Project not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateProjectTool(provider)
      expect(schemaValidates(tool, { name: 'Test' })).toBe(false)
    })

    test('validates at least one field is provided', () => {
      const provider = createMockProvider()
      const tool = makeUpdateProjectTool(provider)
      expect(schemaValidates(tool, { projectId: 'proj-1' })).toBe(false)
    })
  })

  describe('makeArchiveProjectTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeArchiveProjectTool(provider)
      expect(tool.description).toContain('Archive (delete) a project')
    })

    test('archives project successfully with high confidence', async () => {
      const provider = createMockProvider({
        archiveProject: mock(() => Promise.resolve({ id: 'proj-1' })),
      })

      const execute = getToolExecutor(makeArchiveProjectTool(provider))
      const result: unknown = await execute({ projectId: 'proj-1', confidence: 0.9 }, { toolCallId: '1', messages: [] })

      expect(result).toMatchObject({ id: 'proj-1' })
    })

    test('returns confirmation_required when confidence is below threshold', async () => {
      const provider = createMockProvider()
      const execute = getToolExecutor(makeArchiveProjectTool(provider))
      const result: unknown = await execute(
        { projectId: 'proj-1', label: 'Backend', confidence: 0.6 },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({ status: 'confirmation_required' })
      if (typeof result === 'object' && result !== null && 'message' in result) {
        const message = (result as Record<string, unknown>)['message']
        expect(typeof message === 'string' && message.includes('Backend')).toBe(true)
        expect(typeof message === 'string' && !message.includes('0.6')).toBe(true)
        expect(typeof message === 'string' && !message.includes('0.85')).toBe(true)
      } else {
        throw new Error('Expected result to have a message string')
      }
    })

    test('executes when confidence exactly meets threshold (0.85)', async () => {
      const provider = createMockProvider({
        archiveProject: mock(() => Promise.resolve({ id: 'proj-1' })),
      })

      const execute = getToolExecutor(makeArchiveProjectTool(provider))
      const result: unknown = await execute(
        { projectId: 'proj-1', confidence: 0.85 },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({ id: 'proj-1' })
    })

    test('propagates project not found error', async () => {
      const provider = createMockProvider({
        archiveProject: mock(() => Promise.reject(new Error('Project not found'))),
      })

      const tool = makeArchiveProjectTool(provider)
      const promise = getToolExecutor(tool)(
        { projectId: 'invalid', confidence: 0.9 },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Project not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', () => {
      const provider = createMockProvider()
      const tool = makeArchiveProjectTool(provider)
      expect(schemaValidates(tool, { confidence: 0.9 })).toBe(false)
    })
  })
})
