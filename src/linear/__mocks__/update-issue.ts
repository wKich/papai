import { mock } from 'bun:test'

export interface TeamState {
  id: string
  name: string
}

export interface IssueUpdateInput {
  stateId?: string
  assigneeId?: string
  dueDate?: string
  estimate?: number
}

export interface IssueResponse {
  id: string
  identifier: string
  title: string
  stateId?: string
  assigneeId?: string
  dueDate?: string
  estimate?: number
}

function hasProperty<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === 'object' && value !== null && key in value
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!hasProperty(value, key)) {
    return undefined
  }
  const prop = value[key]
  return typeof prop === 'string' ? prop : undefined
}

function getNumberProperty(value: unknown, key: string): number | undefined {
  if (!hasProperty(value, key)) {
    return undefined
  }
  const prop = value[key]
  return typeof prop === 'number' ? prop : undefined
}

function createMockIssueResponse(input: unknown): IssueResponse {
  return {
    id: 'issue-123',
    identifier: 'TEAM-1',
    title: 'Updated Issue',
    stateId: getStringProperty(input, 'stateId'),
    assigneeId: getStringProperty(input, 'assigneeId'),
    dueDate: getStringProperty(input, 'dueDate'),
    estimate: getNumberProperty(input, 'estimate'),
  }
}

export class MockLinearClient {
  issue(): { team: Promise<{ states: () => Promise<{ nodes: TeamState[] }> }> } {
    return {
      team: Promise.resolve({
        states: (): Promise<{ nodes: TeamState[] }> =>
          Promise.resolve({
            nodes: [
              { id: 'state-1', name: 'Todo' },
              { id: 'state-2', name: 'In Progress' },
              { id: 'state-3', name: 'Done' },
            ],
          }),
      }),
    }
  }

  updateIssue(_issueId: string, input: unknown): { issue: Promise<IssueResponse> } {
    return {
      issue: Promise.resolve(createMockIssueResponse(input)),
    }
  }
}

export function setupUpdateIssueMock(): void {
  const result = mock.module('@linear/sdk', () => ({
    LinearClient: MockLinearClient,
  }))
  if (result instanceof Promise) {
    result.catch(() => {
      // Mock setup errors are handled by the test framework
    })
  }
}
