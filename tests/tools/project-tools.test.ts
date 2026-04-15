import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeCreateProjectTool } from '../../src/tools/create-project.js'
import { makeDeleteProjectTool } from '../../src/tools/delete-project.js'
import { makeGetProjectTool } from '../../src/tools/get-project.js'
import { makeListProjectsTool } from '../../src/tools/list-projects.js'
import { makeUpdateProjectTool } from '../../src/tools/update-project.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
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
    mockLogger()
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

  describe('makeGetProjectTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeGetProjectTool(provider)
      expect(tool.description).toContain('Fetch complete details of a single project')
    })

    test('gets one project by ID', async () => {
      const provider = createMockProvider({
        getProject: mock((projectId: string) =>
          Promise.resolve({ id: projectId, name: 'Project 1', url: 'https://test.com/project/1' }),
        ),
      })

      const tool = makeGetProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      if (!isProject(result)) throw new Error('Invalid result')

      expect(result.id).toBe('proj-1')
      expect(result.name).toBe('Project 1')
    })

    test('calls provider getProject with the project ID', async () => {
      const getProject = mock((projectId: string) =>
        Promise.resolve({ id: projectId, name: 'Project 1', url: 'https://test.com/project/1' }),
      )
      const provider = createMockProvider({ getProject })

      const tool = makeGetProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })

      expect(getProject).toHaveBeenCalledWith('proj-1')
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        getProject: mock(() => Promise.reject(new Error('Project not found'))),
      })

      const tool = makeGetProjectTool(provider)
      const promise = getToolExecutor(tool)({ projectId: 'missing-project' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Project not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates projectId is required', () => {
      const provider = createMockProvider()
      const tool = makeGetProjectTool(provider)
      expect(schemaValidates(tool, {})).toBe(false)
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

  describe('makeDeleteProjectTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeDeleteProjectTool(provider)
      if (tool.description === undefined) throw new Error('Tool description is undefined')
      expect(tool.description).toContain('Delete')
      expect(tool.description.toLowerCase()).toContain('project')
    })

    test('deletes project when confidence is sufficient', async () => {
      const deleteProject = mock(() => Promise.resolve({ id: 'proj-1' }))
      const provider = createMockProvider({ deleteProject })
      const tool = makeDeleteProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')

      const result: unknown = await tool.execute(
        { projectId: 'proj-1', confidence: 0.9 },
        { toolCallId: '1', messages: [] },
      )

      expect(deleteProject).toHaveBeenCalledWith('proj-1')
      if (
        result === null ||
        typeof result !== 'object' ||
        !('id' in result) ||
        typeof (result as Record<string, unknown>)['id'] !== 'string'
      ) {
        throw new Error('Invalid result')
      }
      expect((result as Record<string, unknown>)['id']).toBe('proj-1')
    })

    test('returns confirmation_required when confidence is low', async () => {
      const deleteProject = mock(() => Promise.resolve({ id: 'proj-1' }))
      const provider = createMockProvider({ deleteProject })
      const tool = makeDeleteProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')

      const result: unknown = await tool.execute(
        { projectId: 'proj-1', confidence: 0.5 },
        { toolCallId: '1', messages: [] },
      )

      expect(deleteProject).not.toHaveBeenCalled()
      if (
        result === null ||
        typeof result !== 'object' ||
        !('status' in result) ||
        typeof (result as Record<string, unknown>)['status'] !== 'string'
      ) {
        throw new Error('Invalid result')
      }
      expect((result as Record<string, unknown>)['status']).toBe('confirmation_required')
    })

    test('includes label in confirmation message when provided', async () => {
      const provider = createMockProvider()
      const tool = makeDeleteProjectTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')

      const result: unknown = await tool.execute(
        { projectId: 'proj-1', label: 'My Project', confidence: 0.5 },
        { toolCallId: '1', messages: [] },
      )

      if (
        result === null ||
        typeof result !== 'object' ||
        !('status' in result) ||
        typeof (result as Record<string, unknown>)['status'] !== 'string' ||
        !('message' in result) ||
        typeof (result as Record<string, unknown>)['message'] !== 'string'
      ) {
        throw new Error('Invalid result')
      }
      expect((result as Record<string, unknown>)['status']).toBe('confirmation_required')
      expect((result as Record<string, unknown>)['message']).toContain('My Project')
    })

    test('propagates API errors', async () => {
      const provider = createMockProvider({
        deleteProject: mock(() => Promise.reject(new Error('Project not found'))),
      })
      const tool = makeDeleteProjectTool(provider)
      const promise = getToolExecutor(tool)({ projectId: 'bad-id', confidence: 0.9 }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Project not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('requires projectId', () => {
      const provider = createMockProvider()
      const tool = makeDeleteProjectTool(provider)
      expect(schemaValidates(tool, { confidence: 0.9 })).toBe(false)
    })

    test('requires confidence', () => {
      const provider = createMockProvider()
      const tool = makeDeleteProjectTool(provider)
      expect(schemaValidates(tool, { projectId: 'proj-1' })).toBe(false)
    })
  })
})
