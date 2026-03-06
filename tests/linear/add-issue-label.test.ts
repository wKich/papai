import { describe, expect, test } from 'bun:test'

import { setupAddIssueLabelMock } from '../../src/linear/__mocks__/add-issue-label.js'
import { addIssueLabel } from '../../src/linear/add-issue-label.js'

const mockApiKey = 'test-api-key'

describe('addIssueLabel', () => {
  test('adds label to issue', async () => {
    setupAddIssueLabelMock()
    const result = await addIssueLabel({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      labelId: 'label-456',
    })

    expect(result).toBeDefined()
    expect(result.id).toBe('issue-123')
    expect(result.identifier).toBe('TEAM-1')
    expect(result.title).toBe('Test Issue')
    expect(result.url).toBe('https://linear.app/issue/TEAM-1')
  })
})
