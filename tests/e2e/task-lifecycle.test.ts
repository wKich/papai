import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { getTask } from '../../src/kaneo/get-task.js'
import { listTasks } from '../../src/kaneo/list-tasks.js'
import { searchTasks } from '../../src/kaneo/search-tasks.js'
import { updateTask } from '../../src/kaneo/update-task.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'
import { setupE2EEnvironment, teardownE2EEnvironment } from './setup.js'

describe('E2E: Task Lifecycle', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let workspaceId: string
  let projectId: string

  beforeAll(async () => {
    await setupE2EEnvironment()
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    workspaceId = testClient.getWorkspaceId()
  })

  afterAll(async () => {
    await teardownE2EEnvironment()
  })

  beforeEach(async () => {
    await testClient.cleanup()
    const project = await testClient.createTestProject(`E2E Test ${Date.now()}`)
    projectId = project.id
  })

  test('creates and retrieves a task', async () => {
    const title = 'E2E Test Task'
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title,
    })

    testClient.trackTask(task.id)

    expect(task.title).toBe(title)
    expect(task.number).toBeGreaterThan(0)
    expect(task.projectId).toBe(projectId)

    const retrieved = await getTask({
      config: kaneoConfig,
      taskId: task.id,
    })

    expect(retrieved.id).toBe(task.id)
    expect(retrieved.title).toBe(title)
    expect(retrieved.projectId).toBe(projectId)
  })

  test('updates a task', async () => {
    const originalTitle = 'Original Title'
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: originalTitle,
    })

    testClient.trackTask(task.id)

    const updatedTitle = 'Updated Title'
    const updatedPriority = 'high'
    const updated = await updateTask({
      config: kaneoConfig,
      taskId: task.id,
      title: updatedTitle,
      priority: updatedPriority,
    })

    expect(updated.title).toBe(updatedTitle)
    expect(updated.priority).toBe(updatedPriority)

    const retrieved = await getTask({
      config: kaneoConfig,
      taskId: task.id,
    })

    expect(retrieved.title).toBe(updatedTitle)
    expect(retrieved.priority).toBe(updatedPriority)
  })

  test('lists tasks in a project', async () => {
    const task1 = await createTask({
      config: kaneoConfig,
      projectId,
      title: 'Task 1',
    })
    testClient.trackTask(task1.id)

    const task2 = await createTask({
      config: kaneoConfig,
      projectId,
      title: 'Task 2',
    })
    testClient.trackTask(task2.id)

    const tasks = await listTasks({
      config: kaneoConfig,
      projectId,
    })

    expect(tasks.length).toBeGreaterThanOrEqual(2)

    const titles = tasks.map((t) => t.title)
    expect(titles).toContain('Task 1')
    expect(titles).toContain('Task 2')
  })

  test('searches tasks by keyword', async () => {
    const keyword = `searchtest${Date.now()}`
    const title = `Task with ${keyword} in title`

    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title,
    })
    testClient.trackTask(task.id)

    const results = await searchTasks({
      config: kaneoConfig,
      query: keyword,
      workspaceId,
      projectId,
    })

    expect(results.length).toBeGreaterThan(0)
    const firstResult = results[0]!
    expect(firstResult.id).toBe(task.id)
  })

  test('creates task with all properties', async () => {
    const title = 'Full Task'
    const description = 'This is a full description'
    const priority = 'high'
    const status = 'in_progress'

    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title,
      description,
      priority,
      status,
    })

    testClient.trackTask(task.id)

    const retrieved = await getTask({
      config: kaneoConfig,
      taskId: task.id,
    })

    expect(retrieved.title).toBe(title)
    expect(retrieved.description).toBe(description)
    expect(retrieved.priority).toBe(priority)
    expect(retrieved.status).toBe(status)
  })
})
