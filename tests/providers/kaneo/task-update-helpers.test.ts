import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import type { TaskStatusDeps } from '../../../src/providers/kaneo/task-status.js'
import { performUpdate } from '../../../src/providers/kaneo/task-update-helpers.js'
import { createMockColumn, createMockTask, mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('task-update-helpers', () => {
  const config: KaneoConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }

  let statusDeps: TaskStatusDeps

  beforeEach(() => {
    mockLogger()
    statusDeps = {
      listColumns: (): Promise<Array<{ id: string; name: string }>> =>
        Promise.resolve([
          createMockColumn({ id: 'col-1', name: 'To Do' }),
          createMockColumn({ id: 'col-2', name: 'In Progress' }),
          createMockColumn({ id: 'col-3', name: 'Done', isFinal: true }),
        ]),
    }
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('performUpdate', () => {
    test('fetches existing task then PUTs merged full body', async () => {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []
      setMockFetch((url: string, options: RequestInit) => {
        const parsedBody: unknown = typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined
        requests.push({ url, method: options.method ?? 'GET', body: parsedBody })
        if ((options.method ?? 'GET') === 'GET') {
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createMockTask({
                  id: 'task-1',
                  projectId: 'proj-1',
                  position: 5,
                  title: 'Existing Title',
                  description: 'Existing description',
                  status: 'col-1',
                  priority: 'low',
                }),
              ),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                projectId: 'proj-1',
                position: 5,
                title: 'New Title',
                description: 'Existing description',
                status: 'col-1',
                priority: 'high',
              }),
            ),
            { status: 200 },
          ),
        )
      })

      const result = await performUpdate(config, 'task-1', { title: 'New Title', priority: 'high' }, statusDeps)

      expect(requests).toHaveLength(2)
      expect(requests[0]?.method).toBe('GET')
      expect(requests[0]?.url).toContain('/task/task-1')
      expect(requests[1]?.method).toBe('PUT')
      expect(requests[1]?.url).toContain('/task/task-1')
      expect(requests[1]?.body).toMatchObject({
        title: 'New Title',
        description: 'Existing description',
        status: 'col-1',
        priority: 'high',
        projectId: 'proj-1',
        position: 5,
      })
      expect(result.title).toBe('New Title')
    })

    test('validates and normalizes status through statusDeps', async () => {
      const requests: Array<{ url: string; method: string; body?: unknown }> = []
      setMockFetch((url: string, options: RequestInit) => {
        const parsedBody: unknown = typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined
        requests.push({ url, method: options.method ?? 'GET', body: parsedBody })
        if ((options.method ?? 'GET') === 'GET') {
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createMockTask({
                  id: 'task-1',
                  projectId: 'proj-1',
                  position: 0,
                  status: 'col-1',
                }),
              ),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                projectId: 'proj-1',
                position: 0,
                status: 'col-3',
              }),
            ),
            { status: 200 },
          ),
        )
      })

      await performUpdate(config, 'task-1', { status: 'done' }, statusDeps)

      // validateStatus normalizes status to a slug that matches a column
      expect(requests[1]?.body).toMatchObject({ status: 'done' })
    })

    test('throws when existing task is missing position', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                projectId: 'proj-1',
                // position explicitly null
                position: null,
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      await expect(performUpdate(config, 'task-1', { title: 'x' }, statusDeps)).rejects.toThrow()
    })
  })
})
