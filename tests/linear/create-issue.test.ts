import { describe, expect, test, beforeEach } from 'bun:test'

import { setupCreateIssueFailureMock } from '../../src/linear/__mocks__/create-issue-failure.js'
import { setupCreateIssueMock } from '../../src/linear/__mocks__/create-issue.js'
import { HulyApiError } from '../../src/linear/classify-error.js'
import { createIssue } from '../../src/linear/create-issue.js'

const mockUserId = 12345

describe('createIssue with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('creates issue with required fields', async () => {
    setupCreateIssueMock()
    const result = await createIssue({
      userId: mockUserId,
      title: 'Test Issue',
      projectId: 'project-123',
    })

    expect(result).toBeDefined()
    expect(result.id).toBeDefined()
    expect(result.identifier).toMatch(/^P-\d+$/)
    expect(result.title).toBe('Test Issue')
    expect(result.url).toBeDefined()
  })

  test('creates issue with all optional fields', async () => {
    setupCreateIssueMock()
    const result = await createIssue({
      userId: mockUserId,
      title: 'Test Issue with Options',
      description: 'Description here',
      priority: 1,
      projectId: 'project-123',
      dueDate: '2026-03-15',
      labelIds: ['label-1', 'label-2'],
      estimate: 5,
    })

    expect(result).toBeDefined()
    expect(result.title).toBe('Test Issue with Options')
    expect(result.identifier).toMatch(/^P-\d+$/)
  })

  describe('error handling', () => {
    test('throws HulyApiError on API failure', () => {
      setupCreateIssueFailureMock()
      expect(createIssue({ userId: mockUserId, title: 'Test', projectId: 'project-123' })).rejects.toThrow(HulyApiError)
    })
  })
})
