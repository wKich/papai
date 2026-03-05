import { describe, expect, test } from 'bun:test'

import { setupRemoveIssueLabelMock } from './__mocks__/remove-issue-label.js'
import { removeIssueLabel } from './remove-issue-label.js'

const mockApiKey = 'test-api-key'

describe('removeIssueLabel', () => {
  test('removes label from issue', async () => {
    setupRemoveIssueLabelMock()
    const result = await removeIssueLabel({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      labelId: 'label-456',
    })

    expect(result).toBeDefined()
    expect(result?.id).toBe('issue-123')
    expect(result?.identifier).toBe('TEAM-1')
    expect(result?.title).toBe('Test Issue')
  })
})
