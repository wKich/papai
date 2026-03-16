import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import { archiveTask } from '../../src/kaneo/archive-task.js'
import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { getTask } from '../../src/kaneo/get-task.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Task Archive', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let workspaceId: string
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    workspaceId = testClient.getWorkspaceId()
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
