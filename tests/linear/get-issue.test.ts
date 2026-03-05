import { describe, expect, test } from 'bun:test'

import { setupGetIssueMock } from '../../src/linear/__mocks__/get-issue.js'
import { getIssue } from '../../src/linear/get-issue.js'

const mockApiKey = 'test-api-key'

describe('getIssue', () => {
  test('returns issue details', async () => {
    setupGetIssueMock()
    const result = await getIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('issue-123')
    expect(result.identifier).toBe('TEAM-1')
    expect(result.title).toBe('Test Issue')
    expect(result.priority).toBe(1)
    expect(result.state).toBe('In Progress')
    expect(result.assignee).toBe('John Doe')
  })
})
