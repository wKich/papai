import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { getTask } from '../../src/kaneo/get-task.js'
import { updateTask } from '../../src/kaneo/update-task.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'
import { setupE2EEnvironment, teardownE2EEnvironment } from './setup.js'

describe('E2E: Error Handling', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeAll(async () => {
    await setupE2EEnvironment()
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
  })

  afterAll(async () => {
    await teardownE2EEnvironment()
  })

  beforeEach(async () => {
    await testClient.cleanup()
    const project = await testClient.createTestProject(`Error Test ${Date.now()}`)
    projectId = project.id
  })

  test('throws error for non-existent task', async () => {
    const promise = getTask({ config: kaneoConfig, taskId: 'non-existent-id' })
    await expect(promise).rejects.toThrow()
  })

  test('throws error when updating non-existent task', async () => {
    const promise = updateTask({
      config: kaneoConfig,
      taskId: 'non-existent-id',
      title: 'New title',
    })
    await expect(promise).rejects.toThrow()
  })

  test('handles special characters in task title', async () => {
    const specialTitle = 'Task with émojis and <html> & "quotes"'
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: specialTitle,
    })
    testClient.trackTask(task.id)

    const retrieved = await getTask({ config: kaneoConfig, taskId: task.id })
    expect(retrieved.title).toBe(specialTitle)
  })
})
