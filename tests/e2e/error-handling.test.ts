import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { getTask } from '../../src/providers/kaneo/get-task.js'
import { updateTask } from '../../src/providers/kaneo/update-task.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Error Handling', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
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
