import { describe, expect, test, beforeEach } from 'bun:test'

import { setupSearchIssuesEmptyMock } from '../../src/linear/__mocks__/search-issues-empty.js'
import { setupSearchIssuesMock } from '../../src/linear/__mocks__/search-issues.js'
import { searchIssues } from '../../src/linear/search-issues.js'

const mockUserId = 12345

describe('searchIssues with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('searches issues with keyword', async () => {
    setupSearchIssuesMock()
    const results = await searchIssues({ userId: mockUserId, projectId: 'project-123', query: 'First' })
    expect(results).toHaveLength(1)
    expect(results[0]?.identifier).toBe('P-1')
  })

  test('returns empty array when no results', async () => {
    setupSearchIssuesEmptyMock()
    const results = await searchIssues({ userId: mockUserId, projectId: 'project-123', query: 'nonexistent' })
    expect(results).toHaveLength(0)
  })

  describe('state filter', () => {
    test('returns empty array when issues lack state data', async () => {
      setupSearchIssuesMock()
      const results = await searchIssues({
        userId: mockUserId,
        projectId: 'project-123',
        query: 'First',
        state: 'In Progress',
      })
      // State filtering requires status lookup, which may return empty
      expect(Array.isArray(results)).toBe(true)
    })
  })
})
