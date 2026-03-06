import { describe, expect, test, beforeEach } from 'bun:test'

import { setupArchiveIssueMock } from '../../src/huly/__mocks__/archive-issue.js'
import { archiveIssue } from '../../src/huly/archive-issue.js'

const mockUserId = 12345

describe('archiveIssue with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('archives issue successfully', async () => {
    setupArchiveIssueMock()
    const result = await archiveIssue({
      userId: mockUserId,
      issueId: 'issue-123',
    })

    expect(result).toBeDefined()
    expect(result?.id).toBe('issue-123')
    expect(result?.identifier).toBe('P-1')
    expect(result?.title).toBe('Archived Issue')
    expect(result?.archivedAt).toBeDefined()
  })
})
