import { describe, expect, test, beforeEach } from 'bun:test'

import { setupRemoveIssueLabelMock } from '../../src/linear/__mocks__/remove-issue-label.js'
import { removeIssueLabel } from '../../src/linear/remove-issue-label.js'

const mockUserId = 12345

describe('removeIssueLabel with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('removes label from issue', async () => {
    setupRemoveIssueLabelMock()
    const result = await removeIssueLabel({
      userId: mockUserId,
      projectId: 'project-123',
      issueId: 'issue-123',
      labelId: 'label-456',
    })

    expect(result).toBeDefined()
    expect(result?.id).toBe('issue-123')
    expect(result?.identifier).toBe('TEAM-1')
    expect(result?.title).toBe('Test Issue')
    expect(result?.url).toContain('TEAM-1')
  })
})
