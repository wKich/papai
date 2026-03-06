import { describe, it, expect, beforeEach } from 'bun:test'

import type { PlatformClient } from '@hcengineering/api-client'

import { formatProjectIdentifier, getOrCreateUserProject } from '../../src/linear/project-utils.js'

describe('formatProjectIdentifier', () => {
  it('should format username correctly', () => {
    expect(formatProjectIdentifier('alice')).toBe('P-ALICE')
  })

  it('should format userId correctly', () => {
    expect(formatProjectIdentifier(12345)).toBe('P-12345')
  })

  it('should handle special characters', () => {
    expect(formatProjectIdentifier('user_name-123')).toBe('P-USER_NAME-123')
  })
})

describe('getOrCreateUserProject', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockClient: PlatformClient
  let findOneCalls: Array<{ classRef: unknown; query: Record<string, unknown> }>
  let createDocCalls: Array<{
    classRef: unknown
    space: unknown
    data: Record<string, unknown>
    id: string
  }>

  beforeEach(() => {
    findOneCalls = []
    createDocCalls = []

    mockClient = {
      findOne: (classRef: unknown, query: Record<string, unknown>): Promise<unknown> => {
        findOneCalls.push({ classRef, query })
        return Promise.resolve(null)
      },
      createDoc: (classRef: unknown, space: unknown, data: Record<string, unknown>, id: string): Promise<void> => {
        createDocCalls.push({ classRef, space, data, id })
        return Promise.resolve()
      },
      // oxlint-disable-next-line no-unsafe-type-assertion
    } as unknown as PlatformClient
  })

  it('should return existing project when found', async () => {
    const existingProject = {
      _id: 'existing-project-id',
      identifier: 'P-ALICE',
      name: 'Project alice',
    }

    mockClient.findOne = (classRef: unknown, query: Record<string, unknown>): Promise<unknown> => {
      findOneCalls.push({ classRef, query })
      if (query['identifier'] === 'P-ALICE') {
        return Promise.resolve(existingProject)
      }
      return Promise.resolve(null)
    }

    const result = await getOrCreateUserProject(mockClient, 'alice')

    expect(result._id).toBe('existing-project-id')
    expect(result.identifier).toBe('P-ALICE')
    expect(createDocCalls).toHaveLength(0)
    expect(findOneCalls).toHaveLength(1)
  })

  it('should create new project when not found', async () => {
    mockClient.findOne = (classRef: unknown, query: Record<string, unknown>): Promise<unknown> => {
      findOneCalls.push({ classRef, query })
      // First call: project not found
      if (query['identifier'] === 'P-BOB') {
        return Promise.resolve(null)
      }
      // Second call: workspace space found
      return Promise.resolve({ _id: 'workspace-space-id' })
    }

    const result = await getOrCreateUserProject(mockClient, 'bob')

    expect(result.identifier).toBe('P-BOB')
    expect(result._id).toBeDefined()
    expect(typeof result._id).toBe('string')
    expect(result._id.length).toBeGreaterThan(0)
    expect(createDocCalls).toHaveLength(1)
    const call = createDocCalls[0]!
    expect(call.data['identifier']).toBe('P-BOB')
    expect(call.data['name']).toBe('Project bob')
    expect(call.data['description']).toBe('Auto-created project for user bob')
  })

  it('should throw error when workspace space not found', async () => {
    mockClient.findOne = (classRef: unknown, query: Record<string, unknown>): Promise<unknown> => {
      findOneCalls.push({ classRef, query })
      // Project not found, workspace space not found
      return Promise.resolve(null)
    }

    // oxlint-disable-next-line await-thenable, no-confusing-void-expression
    await expect(getOrCreateUserProject(mockClient, 'charlie')).rejects.toThrow('Workspace space not found')

    expect(findOneCalls).toHaveLength(2)
    expect(createDocCalls).toHaveLength(0)
  })

  it('should return correct project id and identifier for existing project', async () => {
    const existingProject = {
      _id: 'proj-abc-123',
      identifier: 'P-EXISTING',
      name: 'Existing Project',
    }

    mockClient.findOne = (classRef: unknown, query: Record<string, unknown>): Promise<unknown> => {
      findOneCalls.push({ classRef, query })
      if (query['identifier'] === 'P-EXISTING') {
        return Promise.resolve(existingProject)
      }
      return Promise.resolve(null)
    }

    const result = await getOrCreateUserProject(mockClient, 'existing')

    expect(result).toEqual({
      _id: 'proj-abc-123',
      identifier: 'P-EXISTING',
    })
  })

  it('should return correct project id and identifier for new project', async () => {
    let generatedId: string | null = null

    mockClient.findOne = (classRef: unknown, query: Record<string, unknown>): Promise<unknown> => {
      findOneCalls.push({ classRef, query })
      if (query['identifier'] === 'P-NEWUSER') {
        return Promise.resolve(null)
      }
      // Workspace space
      return Promise.resolve({ _id: 'workspace-space' })
    }

    mockClient.createDoc = (
      classRef: unknown,
      space: unknown,
      data: Record<string, unknown>,
      id: string,
    ): Promise<void> => {
      generatedId = id
      createDocCalls.push({ classRef, space, data, id })
      return Promise.resolve()
    }

    const result = await getOrCreateUserProject(mockClient, 'newuser')

    expect(result.identifier).toBe('P-NEWUSER')
    expect(result._id).toBe(generatedId)
    expect(result._id).toMatch(/^[a-zA-Z0-9_-]+$/)
  })
})
