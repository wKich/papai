import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { archiveTask } from '../../src/kaneo/archive-task.js'
import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { getTask } from '../../src/kaneo/get-task.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'
import { setupE2EEnvironment, teardownE2EEnvironment } from './setup.js'

describe('E2E: Task Archive', () => {
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
    const project = await testClient.createTestProject(`Archive Test ${Date.now()}`)
    projectId = project.id
  })

  test('archives a task', async () => {
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: 'Task to archive',
    })
    testClient.trackTask(task.id)

    const result = await archiveTask({
      config: kaneoConfig,
      taskId: task.id,
      workspaceId,
    })

    expect(result.id).toBe(task.id)
    expect(result.archivedAt).toBeDefined()
  })

  test('can still retrieve archived task', async () => {
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: 'Archived task',
    })
    testClient.trackTask(task.id)

    await archiveTask({
      config: kaneoConfig,
      taskId: task.id,
      workspaceId,
    })

    const retrieved = await getTask({ config: kaneoConfig, taskId: task.id })
    expect(retrieved.id).toBe(task.id)
  })
})
