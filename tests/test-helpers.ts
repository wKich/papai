import { mock } from 'bun:test'

import { z } from 'zod'

import type { CreateLabelResponseSchema } from '../src/providers/kaneo/schemas/create-label.js'
import { CreateProjectResponseSchema } from '../src/providers/kaneo/schemas/create-project.js'
import { TaskSchema } from '../src/providers/kaneo/schemas/create-task.js'
import type { ActivityItemSchema } from '../src/providers/kaneo/schemas/get-activities.js'

type CreateTaskResponse = z.infer<typeof TaskSchema>
type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>
type CreateLabelResponse = z.infer<typeof CreateLabelResponseSchema>
type ActivityItem = z.infer<typeof ActivityItemSchema>

type Column = {
  id: string
  name: string
  icon: string | null
  color: string | null
  isFinal: boolean
}

const originalFetch = globalThis.fetch

export function restoreFetch(): void {
  globalThis.fetch = originalFetch
}

interface SafeParseable {
  safeParse: (data: unknown) => { success: boolean }
}

function isSafeParseable(val: unknown): val is SafeParseable {
  return typeof val === 'object' && val !== null && 'safeParse' in val && typeof val.safeParse === 'function'
}

/** Test whether a tool's inputSchema accepts or rejects given data. */
export function schemaValidates(tool: { inputSchema: unknown }, data: unknown): boolean {
  const schema = tool.inputSchema
  if (!isSafeParseable(schema)) {
    throw new Error('Tool inputSchema does not have safeParse')
  }
  return schema.safeParse(data).success
}

export interface ToolExecutor {
  execute: (...args: unknown[]) => Promise<unknown>
}

export function hasExecute(tool: unknown): tool is ToolExecutor {
  return (
    typeof tool === 'object' &&
    tool !== null &&
    'execute' in tool &&
    typeof (tool as Record<string, unknown>)['execute'] === 'function'
  )
}

export function getToolExecutor(tool: unknown): (...args: unknown[]) => Promise<unknown> {
  if (hasExecute(tool)) {
    return tool.execute
  }
  throw new Error('Tool does not have an execute method')
}

// Complete task mock matching CreateTaskResponseSchema
export function createMockTask(overrides: Partial<CreateTaskResponse> = {}): CreateTaskResponse {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    position: 0,
    number: 42,
    userId: null,
    title: 'Test Task',
    description: 'Test description',
    status: 'todo',
    priority: 'medium',
    createdAt: '2026-03-01T00:00:00Z',
    dueDate: null,
    ...overrides,
  }
}

// Complete project mock matching CreateProjectResponseSchema
export function createMockProject(overrides: Partial<CreateProjectResponse> = {}): CreateProjectResponse {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'Test Project',
    slug: 'test-project',
    icon: null,
    description: null,
    createdAt: '2026-03-01T00:00:00Z',
    isPublic: false,
    ...overrides,
  }
}

// Complete label mock matching CreateLabelResponseSchema
export function createMockLabel(overrides: Partial<CreateLabelResponse> = {}): CreateLabelResponse {
  return {
    id: 'label-1',
    name: 'Bug',
    color: '#ff0000',
    createdAt: '2026-03-01T00:00:00Z',
    taskId: null,
    workspaceId: 'ws-1',
    ...overrides,
  }
}

// Complete activity mock matching CreateCommentResponseSchema (for add/update)
// or ActivityItemSchema (for list) - both have same structure
export function createMockActivity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'act-1',
    taskId: 'task-1',
    type: 'comment',
    createdAt: '2026-03-01T00:00:00Z',
    userId: null,
    content: 'Test comment',
    externalUserName: null,
    externalUserAvatar: null,
    externalSource: null,
    externalUrl: null,
    ...overrides,
  }
}

// Activity mock with string createdAt for list endpoint
export function createMockActivityForList(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'act-1',
    taskId: 'task-1',
    type: 'comment',
    createdAt: '2026-03-01T00:00:00Z',
    userId: null,
    content: 'Test comment',
    externalUserName: null,
    externalUserAvatar: null,
    externalSource: null,
    externalUrl: null,
    ...overrides,
  } as ActivityItem
}

// Complete column mock matching ColumnSchema
export function createMockColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: 'col-1',
    name: 'To Do',
    icon: null,
    color: null,
    isFinal: false,
    ...overrides,
  }
}

/**
 * Replace globalThis.fetch with a mock handler for testing.
 * Wraps `mock()` internally so callers don't need `as unknown as` casts.
 */
export function setMockFetch(handler: (url: string, init: RequestInit) => Promise<Response>): void {
  const mocked = mock(handler)
  const wrapped = Object.assign(
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return mocked(url, init ?? {})
    },
    { preconnect: originalFetch.preconnect },
  )
  globalThis.fetch = wrapped
}

// Module mock restoration helpers
const originalModules = new Map<string, Record<string, unknown>>()

export function storeOriginalModule(path: string, original: Record<string, unknown>): void {
  if (!originalModules.has(path)) {
    originalModules.set(path, original)
  }
}

export function restoreModule(path: string): void {
  const original = originalModules.get(path)
  if (original !== undefined) {
    void mock.module(path, () => original)
    originalModules.delete(path)
  }
}

export function restoreAllModules(): void {
  for (const [path, original] of originalModules) {
    void mock.module(path, () => original)
  }
  originalModules.clear()
}

export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(() => {
      resolve()
    })
  })
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, 0)
  })
}
