import { describe, expect, test } from 'bun:test'

import { setupGetIssueLabelsMock } from '../../src/linear/__mocks__/get-issue-labels.js'
import { getIssueLabels } from '../../src/linear/get-issue-labels.js'

const mockApiKey = 'test-api-key'

describe('getIssueLabels', () => {
  test('returns labels for issue', async () => {
    setupGetIssueLabelsMock()
    const result = await getIssueLabels({
      apiKey: mockApiKey,
      issueId: 'issue-123',
    })

    expect(result).toHaveLength(2)
    expect(result[0]?.name).toBe('Bug')
    expect(result[1]?.name).toBe('Feature')
  })
})
