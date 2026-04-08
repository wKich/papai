import { describe, expect, test } from 'bun:test'

import type { Task, TaskListItem } from '../../src/providers/types.js'

describe('Task type', () => {
  test('Task accepts optional extended fields', () => {
    const task: Task = {
      id: 'PROJ-1',
      title: 'Test Task',
      url: 'https://example.com/issue/PROJ-1',
      number: 42,
      reporter: { id: 'u-1', login: 'alice', name: 'Alice Smith' },
      updater: { id: 'u-2', login: 'bob', name: 'Bob Jones' },
      votes: 5,
      commentsCount: 3,
      resolved: '2024-01-01T00:00:00.000Z',
      attachments: [{ id: 'a-1', name: 'file.pdf' }],
      visibility: { $type: 'LimitedVisibility' },
      parent: { id: '100', idReadable: 'PROJ-0', title: 'Parent' },
      subtasks: [{ id: '200', idReadable: 'PROJ-2', title: 'Subtask', status: undefined }],
    }
    expect(task.number).toBe(42)
    expect(task.reporter?.name).toBe('Alice Smith')
    expect(task.votes).toBe(5)
  })
})

describe('TaskListItem type', () => {
  test('TaskListItem accepts number and resolved', () => {
    const item: TaskListItem = {
      id: 'PROJ-1',
      title: 'Test Task',
      number: 42,
      resolved: '2024-01-01T00:00:00.000Z',
      url: 'https://example.com/issue/PROJ-1',
    }
    expect(item.number).toBe(42)
    expect(item.resolved).toBe('2024-01-01T00:00:00.000Z')
  })
})
