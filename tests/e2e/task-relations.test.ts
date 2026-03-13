import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { addTaskRelation } from '../../src/kaneo/add-task-relation.js'
import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { getTask } from '../../src/kaneo/get-task.js'
import { removeTaskRelation } from '../../src/kaneo/remove-task-relation.js'
import { updateTaskRelation } from '../../src/kaneo/update-task-relation.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'
import { setupE2EEnvironment } from './setup.js'

describe('E2E: Task Relations', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeAll(async () => {
    await setupE2EEnvironment()
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
  })

  beforeEach(async () => {
    await testClient.cleanup()
    const project = await testClient.createTestProject(`Relations Test ${Date.now()}`)
    projectId = project.id
  })

  test('adds blocks relation between tasks', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Blocking task' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Blocked task' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    const relation = await addTaskRelation({
      config: kaneoConfig,
      taskId: task1.id,
      relatedTaskId: task2.id,
      type: 'blocks',
    })

    expect(relation.taskId).toBe(task1.id)
    expect(relation.relatedTaskId).toBe(task2.id)
    expect(relation.type).toBe('blocks')

    // Verify in task description
    const task1WithRel = await getTask({ config: kaneoConfig, taskId: task1.id })
    expect(task1WithRel.description).toContain('blocks:')
    expect(task1WithRel.description).toContain(task2.id)
  })

  test('adds duplicate relation', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Original task' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Duplicate task' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    const relation = await addTaskRelation({
      config: kaneoConfig,
      taskId: task1.id,
      relatedTaskId: task2.id,
      type: 'duplicate',
    })
    expect(relation.type).toBe('duplicate')
  })

  test('adds related relation', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Task A' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Task B' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    const relation = await addTaskRelation({
      config: kaneoConfig,
      taskId: task1.id,
      relatedTaskId: task2.id,
      type: 'related',
    })
    expect(relation.type).toBe('related')
  })

  test('adds parent relation', async () => {
    const parentTask = await createTask({ config: kaneoConfig, projectId, title: 'Parent task' })
    const childTask = await createTask({ config: kaneoConfig, projectId, title: 'Child task' })
    testClient.trackTask(parentTask.id)
    testClient.trackTask(childTask.id)

    const relation = await addTaskRelation({
      config: kaneoConfig,
      taskId: childTask.id,
      relatedTaskId: parentTask.id,
      type: 'parent',
    })
    expect(relation.type).toBe('parent')
  })

  test('updates relation type', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Task 1' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Task 2' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    await addTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task2.id, type: 'related' })
    const updated = await updateTaskRelation({
      config: kaneoConfig,
      taskId: task1.id,
      relatedTaskId: task2.id,
      type: 'blocks',
    })

    expect(updated.type).toBe('blocks')
  })

  test('removes relation', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Task 1' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Task 2' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    await addTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task2.id, type: 'related' })
    const removed = await removeTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task2.id })

    expect(removed.success).toBe(true)

    // Verify relation is removed
    const task1WithRel = await getTask({ config: kaneoConfig, taskId: task1.id })
    expect(task1WithRel.description).not.toContain(task2.id)
  })

  test('handles multiple relations on same task', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Main task' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Related task' })
    const task3 = await createTask({ config: kaneoConfig, projectId, title: 'Blocking task' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)
    testClient.trackTask(task3.id)

    await addTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task2.id, type: 'related' })
    await addTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task3.id, type: 'blocked_by' })

    const task1WithRels = await getTask({ config: kaneoConfig, taskId: task1.id })
    expect(task1WithRels.description).toContain('related:')
    expect(task1WithRels.description).toContain('blocked_by:')
  })

  test('error when relating to non-existent task', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Existing task' })
    testClient.trackTask(task1.id)

    const promise = addTaskRelation({
      config: kaneoConfig,
      taskId: task1.id,
      relatedTaskId: 'non-existent-id',
      type: 'related',
    })
    expect(promise).rejects.toThrow()
  })
})
