import { describe, expect, test } from 'bun:test'

import { setupSearchIssuesEmptyMock } from '../../src/linear/__mocks__/search-issues-empty.js'
import { setupSearchIssuesMock } from '../../src/linear/__mocks__/search-issues.js'
import { searchIssues } from '../../src/linear/search-issues.js'

const mockApiKey = 'test-api-key'

describe('searchIssues', () => {
  test('searches issues with keyword', async () => {
    setupSearchIssuesMock()
    const results = await searchIssues({ apiKey: mockApiKey, query: 'test' })
    expect(results).toHaveLength(2)
    expect(results[0]?.identifier).toBe('TEAM-1')
  })

  test('returns empty array when no results', async () => {
    setupSearchIssuesEmptyMock()
    const results = await searchIssues({ apiKey: mockApiKey, query: 'nonexistent' })
    expect(results).toHaveLength(0)
  })

  describe('state filter', () => {
    test('returns empty array when issues lack state data', async () => {
      setupSearchIssuesMock()
      const results = await searchIssues({ apiKey: mockApiKey, query: 'test', state: 'In Progress' })
      expect(results).toHaveLength(0)
    })
  })
})
