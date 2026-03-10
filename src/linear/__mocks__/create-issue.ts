import { mock } from 'bun:test'

export interface CreateIssueInput {
  title: string
  priority?: number
}

export interface IssuePayload {
  id: string
  identifier: string
  title: string
  priority: number
  url: string
}

function hasProperty<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === 'object' && value !== null && key in value
}

function isCreateIssueInput(value: unknown): value is CreateIssueInput {
  if (!hasProperty(value, 'title')) {
    return false
  }
  return typeof value['title'] === 'string'
}

function createMockIssue(input: unknown): IssuePayload {
  if (!isCreateIssueInput(input)) {
    throw new Error('Invalid input: title is required')
  }
  return {
    id: 'issue-123',
    identifier: 'TEAM-1',
    title: input.title,
    priority: input.priority ?? 0,
    url: 'https://linear.app/issue/TEAM-1',
  }
}

export class MockLinearClient {
  constructor(public config: { apiKey: string }) {}

  createIssue(input: unknown): { issue: Promise<IssuePayload> } {
    return {
      issue: Promise.resolve(createMockIssue(input)),
    }
  }
}

export function setupCreateIssueMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
