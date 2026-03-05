import { describe, expect, test } from 'bun:test'

import { setupArchiveIssueMock } from './__mocks__/archive-issue.js'
import { archiveIssue } from './archive-issue.js'

const mockApiKey = 'test-api-key'

describe('archiveIssue', () => {
  test('archives issue successfully', async () => {
    setupArchiveIssueMock()
    const result = await archiveIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
    })

    expect(result).toBeDefined()
    expect(result?.id).toBe('issue-123')
    expect(result?.identifier).toBe('TEAM-1')
    expect(result?.title).toBe('Archived Issue')
    expect(result?.archivedAt).toBeDefined()
  })
})
