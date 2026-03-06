import { describe, expect, test, beforeEach } from 'bun:test'

import { setupAddIssueLabelMock } from '../../src/linear/__mocks__/add-issue-label.js'
import { addIssueLabel } from '../../src/linear/add-issue-label.js'

const mockUserId = 12345

describe('addIssueLabel with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('adds label to issue', async () => {
    setupAddIssueLabelMock()
    const result = await addIssueLabel({
      userId: mockUserId,
      projectId: 'project-123',
      issueId: 'issue-123',
      labelId: 'label-456',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('issue-123')
    expect(result.identifier).toBe('TEAM-1')
    expect(result.title).toBe('Test Issue')
    expect(result.url).toContain('TEAM-1')
  })
})
