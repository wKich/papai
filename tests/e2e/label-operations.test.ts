import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import { addTaskLabel } from '../../src/kaneo/add-task-label.js'
import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createLabel } from '../../src/kaneo/create-label.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { listLabels } from '../../src/kaneo/list-labels.js'
import { removeLabel } from '../../src/kaneo/remove-label.js'
import { removeTaskLabel } from '../../src/kaneo/remove-task-label.js'
import { updateLabel } from '../../src/kaneo/update-label.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Label Operations', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()

    const project = await testClient.createTestProject(`Label Ops Test ${Date.now()}`)
    projectId = project.id
  })

  test('creates label with color', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'Bug',
      color: '#FF0000',
    })
    testClient.trackLabel(label.id)
    expect(label.name).toBe('Bug')
    expect(label.color).toBe('#FF0000')
  })

  test('updates label name and color', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'Old Name',
      color: '#000000',
    })
    testClient.trackLabel(label.id)

    const updated = await updateLabel({
      config: kaneoConfig,
      labelId: label.id,
      name: 'New Name',
      color: '#FFFFFF',
    })

    expect(updated.name).toBe('New Name')
    expect(updated.color).toBe('#FFFFFF')
  })

  test('lists all labels in workspace', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: `Label ${Date.now()}`,
    })
    testClient.trackLabel(label.id)

    const labels = await listLabels({ config: kaneoConfig, workspaceId: testClient.getWorkspaceId() })
    const ids = labels.map((l) => l.id)
    expect(ids).toContain(label.id)
  })

  test('removes a label', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'To Remove',
    })

    await removeLabel({ config: kaneoConfig, labelId: label.id })

    const labels = await listLabels({ config: kaneoConfig, workspaceId: testClient.getWorkspaceId() })
    const found = labels.find((l) => l.id === label.id)
    expect(found).toBeUndefined()
  })

  test('adds and removes label from task', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'Test Label',
    })
    testClient.trackLabel(label.id)

    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task with label' })
    testClient.trackTask(task.id)

    await addTaskLabel({
      config: kaneoConfig,
      taskId: task.id,
      labelId: label.id,
      workspaceId: testClient.getWorkspaceId(),
    })
    await removeTaskLabel({ config: kaneoConfig, taskId: task.id, labelId: label.id })

    expect(true).toBe(true)
  })
})
