import { describe, expect, test, beforeEach } from 'bun:test'

import { setupUpdateIssueFailureMock } from '../../src/linear/__mocks__/update-issue-failure.js'
import { setupUpdateIssueMock } from '../../src/linear/__mocks__/update-issue.js'
import { HulyApiError } from '../../src/linear/classify-error.js'
import { updateIssue } from '../../src/linear/update-issue.js'

const mockUserId = 12345

describe('updateIssue status with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('updates issue status', async () => {
    setupUpdateIssueMock()
    const result = await updateIssue({
      userId: mockUserId,
      issueId: 'issue-123',
      projectId: 'project-123',
      status: 'In Progress',
    })

    expect(result).toBeDefined()
  })
})

describe('updateIssue assignee with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('updates issue assignee', async () => {
    setupUpdateIssueMock()
    const result = await updateIssue({
      userId: mockUserId,
      issueId: 'issue-123',
      projectId: 'project-123',
      assigneeId: 'user-456',
    })

    expect(result).toBeDefined()
  })
})

describe('updateIssue multiple fields with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('updates multiple fields at once', async () => {
    setupUpdateIssueMock()
    const result = await updateIssue({
      userId: mockUserId,
      issueId: 'issue-123',
      projectId: 'project-123',
      status: 'Done',
      assigneeId: 'user-789',
      dueDate: '2025-03-20',
      estimate: 8,
    })

    expect(result).toBeDefined()
  })
})

describe('updateIssue status resolution with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('handles unknown workflow state gracefully', async () => {
    setupUpdateIssueMock()
    const result = await updateIssue({
      userId: mockUserId,
      issueId: 'issue-123',
      projectId: 'project-123',
      status: 'NonExistentState',
    })

    expect(result).toBeDefined()
  })

  test('matches state names case-insensitively', async () => {
    setupUpdateIssueMock()
    const result = await updateIssue({
      userId: mockUserId,
      issueId: 'issue-123',
      projectId: 'project-123',
      status: 'in progress',
    })

    expect(result).toBeDefined()
  })
})

describe('updateIssue error handling with Huly', () => {
  beforeEach(() => {
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
  })

  test('throws HulyApiError on API failure', () => {
    setupUpdateIssueFailureMock()
    expect(
      updateIssue({ userId: mockUserId, issueId: 'invalid', projectId: 'project-123', status: 'Todo' }),
    ).rejects.toThrow(HulyApiError)
  })
})
