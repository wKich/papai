import { mock } from 'bun:test'

import type { Capability, TaskProvider } from '../../src/providers/types.js'

const ALL_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  // Tasks
  'tasks.delete',
  'tasks.relations',
  'tasks.watchers',
  'tasks.votes',
  'tasks.visibility',
  // Projects (full CRUD)
  'projects.read',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.delete',
  'projects.team',
  // Comments (full CRUD)
  'comments.read',
  'comments.create',
  'comments.update',
  'comments.delete',
  'comments.reactions',
  // Labels (full CRUD + assignment)
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.assign',
  // Statuses (full CRUD)
  'statuses.list',
  'statuses.create',
  'statuses.update',
  'statuses.delete',
  'statuses.reorder',
  // Attachments
  'attachments.list',
  'attachments.upload',
  'attachments.delete',
  // Work items
  'workItems.list',
  'workItems.create',
  'workItems.update',
  'workItems.delete',
])

/** Create a mock TaskProvider with all methods stubbed. Override specific methods as needed. */
export function createMockProvider(overrides: Partial<TaskProvider> = {}): TaskProvider {
  return {
    name: 'mock',
    capabilities: ALL_CAPABILITIES,
    configRequirements: [],
    createTask: mock(() =>
      Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo', url: 'https://test.com/task/1' }),
    ),
    getTask: mock(() =>
      Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo', url: 'https://test.com/task/1' }),
    ),
    updateTask: mock(() =>
      Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo', url: 'https://test.com/task/1' }),
    ),
    listTasks: mock(() => Promise.resolve([])),
    searchTasks: mock(() => Promise.resolve([])),
    deleteTask: mock(() => Promise.resolve({ id: 'task-1' })),
    listUsers: mock(() => Promise.resolve([{ id: 'user-1', login: 'alice', name: 'Alice Smith' }])),
    getCurrentUser: mock(() => Promise.resolve({ id: 'user-1', login: 'alice', name: 'Alice Smith' })),
    getProject: mock(() => Promise.resolve({ id: 'proj-1', name: 'Test', url: 'https://test.com/project/1' })),
    listProjects: mock(() => Promise.resolve([])),
    createProject: mock(() => Promise.resolve({ id: 'proj-1', name: 'Test', url: 'https://test.com/project/1' })),
    updateProject: mock(() => Promise.resolve({ id: 'proj-1', name: 'Test', url: 'https://test.com/project/1' })),
    deleteProject: mock(() => Promise.resolve({ id: 'proj-1' })),
    listProjectTeam: mock(() => Promise.resolve([{ id: 'user-1', login: 'alice', name: 'Alice Smith' }])),
    addProjectMember: mock((projectId: string, userId: string) => Promise.resolve({ projectId, userId })),
    removeProjectMember: mock((projectId: string, userId: string) => Promise.resolve({ projectId, userId })),
    getComment: mock(() => Promise.resolve({ id: 'comment-1', body: 'test' })),
    addComment: mock(() => Promise.resolve({ id: 'comment-1', body: 'test' })),
    getComments: mock(() => Promise.resolve([])),
    updateComment: mock(() => Promise.resolve({ id: 'comment-1', body: 'test' })),
    removeComment: mock(() => Promise.resolve({ id: 'comment-1' })),
    addCommentReaction: mock((_taskId: string, _commentId: string, reaction: string) =>
      Promise.resolve({ id: 'reaction-1', reaction, author: { id: 'user-1', login: 'alice' } }),
    ),
    removeCommentReaction: mock((taskId: string, commentId: string, reactionId: string) =>
      Promise.resolve({ id: reactionId, taskId, commentId }),
    ),
    listLabels: mock(() => Promise.resolve([])),
    createLabel: mock(() => Promise.resolve({ id: 'label-1', name: 'test' })),
    updateLabel: mock(() => Promise.resolve({ id: 'label-1', name: 'test' })),
    removeLabel: mock(() => Promise.resolve({ id: 'label-1' })),
    addTaskLabel: mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' })),
    removeTaskLabel: mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' })),
    addRelation: mock(() => Promise.resolve({ taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' })),
    updateRelation: mock(() => Promise.resolve({ taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' })),
    removeRelation: mock(() => Promise.resolve({ taskId: 'task-1', relatedTaskId: 'task-2' })),
    listWatchers: mock(() => Promise.resolve([{ id: 'user-1', login: 'alice', name: 'Alice Smith' }])),
    addWatcher: mock((taskId: string, userId: string) => Promise.resolve({ taskId, userId })),
    removeWatcher: mock((taskId: string, userId: string) => Promise.resolve({ taskId, userId })),
    addVote: mock((taskId: string) => Promise.resolve({ taskId })),
    removeVote: mock((taskId: string) => Promise.resolve({ taskId })),
    setVisibility: mock(
      (taskId: string, visibility: { kind: 'public' | 'restricted'; userIds?: string[]; groupIds?: string[] }) =>
        Promise.resolve({
          taskId,
          visibility:
            visibility.kind === 'public'
              ? { kind: 'public' as const }
              : {
                  kind: 'restricted' as const,
                  users: visibility.userIds?.map((id) => ({ id })),
                  groups: visibility.groupIds?.map((id) => ({ name: id })),
                },
        }),
    ),
    listStatuses: mock(() => Promise.resolve([])),
    createStatus: mock((_projectId: string, params: { name: string }) =>
      Promise.resolve({ id: 'status-1', name: params.name }),
    ),
    updateStatus: mock((_projectId: string, _statusId: string, params: { name?: string }) =>
      Promise.resolve({ id: 'status-1', name: params.name ?? 'Test' }),
    ),
    deleteStatus: mock((_projectId: string, statusId: string) => Promise.resolve({ id: statusId })),
    reorderStatuses: mock(() => Promise.resolve(undefined)),
    listAttachments: mock(() => Promise.resolve([])),
    uploadAttachment: mock(() => Promise.resolve({ id: 'att-1', name: 'file.txt', url: 'https://test.com/att/1' })),
    deleteAttachment: mock(() => Promise.resolve({ id: 'att-1' })),
    listWorkItems: mock(() => Promise.resolve([])),
    createWorkItem: mock((_taskId: string, params: { duration: string }) =>
      Promise.resolve({
        id: 'wi-1',
        taskId: _taskId,
        author: 'user',
        date: '2024-01-15',
        duration: params.duration,
      }),
    ),
    updateWorkItem: mock((_taskId: string, workItemId: string) =>
      Promise.resolve({ id: workItemId, taskId: _taskId, author: 'user', date: '2024-01-15', duration: 'PT1H' }),
    ),
    deleteWorkItem: mock((_taskId: string, workItemId: string) => Promise.resolve({ id: workItemId })),
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
