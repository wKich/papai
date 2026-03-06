import { describe, expect, test } from 'bun:test'

import { setupCreateIssueFailureMock } from '../../src/linear/__mocks__/create-issue-failure.js'
import { setupCreateIssueMock } from '../../src/linear/__mocks__/create-issue.js'
import { HulyApiError } from '../../src/linear/classify-error.js'
import { createIssue } from '../../src/linear/create-issue.js'

const mockApiKey = 'test-api-key'

describe('createIssue', () => {
  test('creates issue with minimal parameters', async () => {
    setupCreateIssueMock()
    const result = await createIssue({
      apiKey: mockApiKey,
      title: 'Test Issue',
      teamId: 'team-123',
    })

    expect(result).toBeDefined()
    expect(result?.id).toBe('issue-123')
    expect(result?.identifier).toBe('TEAM-1')
  })

  test('creates issue with all parameters', async () => {
    setupCreateIssueMock()
    const result = await createIssue({
      apiKey: mockApiKey,
      title: 'Full Test Issue',
      description: 'A detailed description',
      priority: 1,
      projectId: 'proj-456',
      teamId: 'team-123',
      dueDate: '2025-03-15',
      labelIds: ['label-1', 'label-2'],
      estimate: 5,
    })

    expect(result).toBeDefined()
    expect(result?.priority).toBe(1)
  })

  describe('error handling', () => {
    test('throws HulyApiError on API failure', () => {
      setupCreateIssueFailureMock()
      expect(createIssue({ apiKey: 'invalid', title: 'Test', teamId: 'team-123' })).rejects.toThrow(HulyApiError)
    })
  })
})
