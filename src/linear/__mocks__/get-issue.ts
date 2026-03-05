import { mock } from 'bun:test'

export interface StateNode {
  id: string
  name: string
}

export interface AssigneeNode {
  id: string
  displayName: string
}

export class MockLinearClient {
  issue(): Promise<{
    id: string
    identifier: string
    title: string
    description: string | null
    priority: number
    url: string
    dueDate: string | null
    estimate: number | null
    state: Promise<StateNode | null>
    assignee: Promise<AssigneeNode | null>
  }> {
    return Promise.resolve({
      id: 'issue-123',
      identifier: 'TEAM-1',
      title: 'Test Issue',
      description: 'Test description',
      priority: 1,
      url: 'https://linear.app/issue/TEAM-1',
      dueDate: '2025-03-15',
      estimate: 5,
      state: Promise.resolve({ id: 'state-1', name: 'In Progress' }),
      assignee: Promise.resolve({ id: 'user-1', displayName: 'John Doe' }),
    })
  }
}

export function setupGetIssueMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
