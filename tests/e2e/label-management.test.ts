import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { addTaskLabel } from '../../src/kaneo/add-task-label.js'
import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createLabel } from '../../src/kaneo/create-label.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { listLabels } from '../../src/kaneo/list-labels.js'
import { removeLabel } from '../../src/kaneo/remove-label.js'
import { removeTaskLabel } from '../../src/kaneo/remove-task-label.js'
import { updateLabel } from '../../src/kaneo/update-label.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'
import { setupE2EEnvironment, teardownE2EEnvironment } from './setup.js'

describe('E2E: Label Management', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string
  const createdLabelIds: string[] = []

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

    // Clean up labels from previous test in parallel
    await Promise.all(
      createdLabelIds.map(async (labelId) => {
        try {
          await removeLabel({ config: kaneoConfig, labelId })
        } catch {
          // ignore cleanup errors
        }
      }),
    )
    createdLabelIds.length = 0

    const project = await testClient.createTestProject(`Label Test ${Date.now()}`)
    projectId = project.id
  })

  test('creates and lists labels', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      name: 'E2E Label',
      color: '#FF5733',
      workspaceId: testClient.getWorkspaceId(),
    })
    createdLabelIds.push(label.id)

    expect(label.name).toBe('E2E Label')
    expect(label.color).toBe('#FF5733')

    const labels = await listLabels({ config: kaneoConfig, workspaceId: testClient.getWorkspaceId() })
    const found = labels.find((l) => l.id === label.id)
    expect(found).toBeDefined()
    expect(found?.name).toBe('E2E Label')
  })

  test('updates a label', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      name: 'Original Label',
      workspaceId: testClient.getWorkspaceId(),
    })
    createdLabelIds.push(label.id)

    const updated = await updateLabel({
      config: kaneoConfig,
      labelId: label.id,
      name: 'Updated Label',
      color: '#33FF57',
    })

    expect(updated.name).toBe('Updated Label')
    expect(updated.color).toBe('#33FF57')
  })

  test('adds and removes label from task', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      name: 'Test Label',
      workspaceId: testClient.getWorkspaceId(),
    })
    createdLabelIds.push(label.id)

    const task = await createTask({
      config: kaneoConfig,
      title: 'Label Test Task',
      projectId,
    })
    testClient.trackTask(task.id)

    // Add label to task
    const addResult = await addTaskLabel({
      config: kaneoConfig,
      taskId: task.id,
      labelId: label.id,
      workspaceId: testClient.getWorkspaceId(),
    })
    expect(addResult.taskId).toBe(task.id)
    expect(addResult.labelId).toBe(label.id)

    // Remove label from task
    const removeResult = await removeTaskLabel({
      config: kaneoConfig,
      taskId: task.id,
      labelId: label.id,
    })
    expect(removeResult.taskId).toBe(task.id)
    expect(removeResult.labelId).toBe(label.id)
    expect(removeResult.success).toBe(true)
  })
})
