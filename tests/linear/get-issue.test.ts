import { describe, expect, test, beforeEach } from 'bun:test'

import { setupGetIssueMock } from '../../src/linear/__mocks__/get-issue.js'
import { getIssue } from '../../src/linear/get-issue.js'

const mockUserId = 12345

describe('getIssue with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('returns issue details', async () => {
    setupGetIssueMock()
    const result = await getIssue({
      userId: mockUserId,
      issueId: 'issue-123',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('issue-123')
    expect(result.identifier).toBe('P-1')
    expect(result.title).toBe('Test Issue')
    expect(result.priority).toBe(1)
    expect(result.state).toBe('In Progress')
    expect(result.assignee).toBe('John Doe')
    expect(result.labels).toHaveLength(2)
  })
})
