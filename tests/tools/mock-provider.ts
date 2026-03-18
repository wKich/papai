import { mock } from 'bun:test'

import type { Capability, TaskProvider } from '../../src/providers/types.js'

const ALL_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'tasks.archive',
  'tasks.delete',
  'tasks.relations',
  'projects.crud',
  'comments.crud',
  'labels.crud',
  'statuses.crud',
])

/** Create a mock TaskProvider with all methods stubbed. Override specific methods as needed. */
export function createMockProvider(overrides: Partial<TaskProvider> = {}): TaskProvider {
  return {
    name: 'mock',
    capabilities: ALL_CAPABILITIES,
    configRequirements: [],
    createTask: mock(() => Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo' })),
    getTask: mock(() => Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo' })),
    updateTask: mock(() => Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo' })),
    listTasks: mock(() => Promise.resolve([])),
    searchTasks: mock(() => Promise.resolve([])),
    archiveTask: mock(() => Promise.resolve({ id: 'task-1' })),
    deleteTask: mock(() => Promise.resolve({ id: 'task-1' })),
    listProjects: mock(() => Promise.resolve([])),
    createProject: mock(() => Promise.resolve({ id: 'proj-1', name: 'Test' })),
    updateProject: mock(() => Promise.resolve({ id: 'proj-1', name: 'Test' })),
    archiveProject: mock(() => Promise.resolve({ id: 'proj-1' })),
    addComment: mock(() => Promise.resolve({ id: 'comment-1', body: 'test' })),
    getComments: mock(() => Promise.resolve([])),
    updateComment: mock(() => Promise.resolve({ id: 'comment-1', body: 'test' })),
    removeComment: mock(() => Promise.resolve({ id: 'comment-1' })),
    listLabels: mock(() => Promise.resolve([])),
    createLabel: mock(() => Promise.resolve({ id: 'label-1', name: 'test' })),
    updateLabel: mock(() => Promise.resolve({ id: 'label-1', name: 'test' })),
    removeLabel: mock(() => Promise.resolve({ id: 'label-1' })),
    addTaskLabel: mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' })),
    removeTaskLabel: mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' })),
    addRelation: mock(() => Promise.resolve({ taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' })),
    updateRelation: mock(() => Promise.resolve({ taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' })),
    removeRelation: mock(() => Promise.resolve({ taskId: 'task-1', relatedTaskId: 'task-2' })),
    listStatuses: mock(() => Promise.resolve([])),
    createStatus: mock(() => Promise.resolve({ id: 'status-1', name: 'Test' })),
    updateStatus: mock(() => Promise.resolve({ id: 'status-1', name: 'Test' })),
    deleteStatus: mock(() => Promise.resolve({ id: 'status-1' })),
    reorderStatuses: mock(() => Promise.resolve()),
    buildTaskUrl: mock((_taskId: string, _projectId?: string) => 'https://test.com/task/1'),
    buildProjectUrl: mock((_projectId: string) => 'https://test.com/project/1'),
    classifyError: mock(() => ({
      type: 'provider' as const,
      code: 'unknown' as const,
      originalError: new Error('test'),
    })),
    getPromptAddendum: mock(() => ''),
    ...overrides,
  }
}
