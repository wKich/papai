import { mock } from 'bun:test'

export interface StateNode {
  id: string
  name: string
}

export interface AssigneeNode {
  id: string
  displayName: string
}

export interface LabelNode {
  id: string
  name: string
  color: string
}

export interface RelationNode {
  id: string
  type: string
  relatedIssue: Promise<{ id: string; identifier: string } | null>
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
    labels: () => Promise<{ nodes: (LabelNode | null)[] }>
    relations: () => Promise<{ nodes: (RelationNode | null)[] }>
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
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: 'label-1', name: 'Bug', color: '#ff0000' },
            { id: 'label-2', name: 'Feature', color: '#00ff00' },
          ],
        }),
      relations: () =>
        Promise.resolve({
          nodes: [
            {
              id: 'relation-1',
              type: 'blocks',
              relatedIssue: Promise.resolve({ id: 'issue-456', identifier: 'TEAM-2' }),
            },
          ],
        }),
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
