import { describe, expect, it, mock } from 'bun:test'

import { fetchIssue, fetchProject, fetchLabel } from '../../../src/huly/utils/fetchers.js'

class MockHulyClient {
  private returnValue: unknown

  constructor(returnValue: unknown) {
    this.returnValue = returnValue
  }

  findOne = mock((): Promise<unknown> => Promise.resolve(this.returnValue))

  async close(): Promise<void> {}
}

function createMockClient(returnValue: unknown): MockHulyClient {
  return new MockHulyClient(returnValue)
}

describe('entity fetchers', () => {
  describe('fetchIssue', () => {
    it('should return issue when found', async () => {
      const mockIssue = { _id: 'issue-123', identifier: 'TEST-1', title: 'Test Issue' }
      const client = createMockClient(mockIssue)

      const result = await fetchIssue(client, 'issue-123')
      expect(result).toBe(mockIssue)
    })

    it('should throw error when issue not found (null)', () => {
      const client = createMockClient(null)
      expect(fetchIssue(client, 'issue-123')).rejects.toThrow('Issue not found: issue-123')
    })

    it('should throw error when issue not found (undefined)', () => {
      const client = createMockClient(undefined)
      expect(fetchIssue(client, 'issue-123')).rejects.toThrow('Issue not found: issue-123')
    })
  })

  describe('fetchProject', () => {
    it('should return project when found', async () => {
      const mockProject = { _id: 'proj-123', identifier: 'TEST', name: 'Test Project' }
      const client = createMockClient(mockProject)

      const result = await fetchProject(client, 'proj-123')
      expect(result).toBe(mockProject)
    })

    it('should throw error when project not found', () => {
      const client = createMockClient(undefined)
      expect(fetchProject(client, 'proj-123')).rejects.toThrow('Project not found: proj-123')
    })
  })

  describe('fetchLabel', () => {
    it('should return label when found', async () => {
      const mockLabel = { _id: 'label-123', title: 'Bug' }
      const client = createMockClient(mockLabel)

      const result = await fetchLabel(client, 'label-123')
      expect(result).toBe(mockLabel)
    })

    it('should throw error when label not found', () => {
      const client = createMockClient(undefined)
      expect(fetchLabel(client, 'label-123')).rejects.toThrow('Label not found: label-123')
    })
  })
})
