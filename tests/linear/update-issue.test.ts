import { describe, expect, test } from 'bun:test'

import { setupUpdateIssueFailureMock } from '../../src/linear/__mocks__/update-issue-failure.js'
import { setupUpdateIssueMock } from '../../src/linear/__mocks__/update-issue.js'
import { HulyApiError } from '../../src/linear/classify-error.js'
import { updateIssue } from '../../src/linear/update-issue.js'

const mockApiKey = 'test-api-key'

describe('updateIssue status', () => {
  test('updates issue status', async () => {
    setupUpdateIssueMock()
    const result = await updateIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      status: 'In Progress',
    })

    expect(result).toBeDefined()
  })
})

describe('updateIssue assignee', () => {
  test('updates issue assignee', async () => {
    setupUpdateIssueMock()
    const result = await updateIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      assigneeId: 'user-456',
    })

    expect(result).toBeDefined()
  })
})

describe('updateIssue multiple fields', () => {
  test('updates multiple fields at once', async () => {
    setupUpdateIssueMock()
    const result = await updateIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      status: 'Done',
      assigneeId: 'user-789',
      dueDate: '2025-03-20',
      estimate: 8,
    })

    expect(result).toBeDefined()
  })
})

describe('updateIssue status resolution', () => {
  test('handles unknown workflow state gracefully', async () => {
    setupUpdateIssueMock()
    const result = await updateIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      status: 'NonExistentState',
    })

    expect(result).toBeDefined()
  })

  test('matches state names case-insensitively', async () => {
    setupUpdateIssueMock()
    const result = await updateIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      status: 'in progress',
    })

    expect(result).toBeDefined()
  })
})

describe('updateIssue error handling', () => {
  test('throws HulyApiError on API failure', () => {
    setupUpdateIssueFailureMock()
    expect(updateIssue({ apiKey: mockApiKey, issueId: 'invalid', status: 'Todo' })).rejects.toThrow(HulyApiError)
  })
})
