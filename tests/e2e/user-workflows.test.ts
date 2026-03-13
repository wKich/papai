import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { addComment } from '../../src/kaneo/add-comment.js'
import { addTaskRelation } from '../../src/kaneo/add-task-relation.js'
import { archiveTask } from '../../src/kaneo/archive-task.js'
import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createColumn } from '../../src/kaneo/create-column.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { getTask } from '../../src/kaneo/get-task.js'
import { listTasks } from '../../src/kaneo/list-tasks.js'
import { updateTask } from '../../src/kaneo/update-task.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'
import { setupE2EEnvironment, teardownE2EEnvironment } from './setup.js'

describe('E2E: User Workflows', () => {
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
    const project = await testClient.createTestProject(`Workflow Test ${Date.now()}`)
    projectId = project.id
  })

  test('full task lifecycle workflow', async () => {
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: 'Full lifecycle task',
      description: 'Initial description',
      priority: 'high',
    })
    testClient.trackTask(task.id)

    await updateTask({ config: kaneoConfig, taskId: task.id, title: 'Updated task title', status: 'in_progress' })
    await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Progress update' })
    await archiveTask({ config: kaneoConfig, taskId: task.id, workspaceId: testClient.getWorkspaceId() })

    const finalTask = await getTask({ config: kaneoConfig, taskId: task.id })
    expect(finalTask.title).toBe('Updated task title')
    expect(finalTask.status).toBe('in_progress')
  })

  test('project setup workflow', async () => {
    await createColumn({ config: kaneoConfig, projectId, name: 'To Do' })
    await createColumn({ config: kaneoConfig, projectId, name: 'In Progress' })
    await createColumn({ config: kaneoConfig, projectId, name: 'Done', isFinal: true })

    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Task 1' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Task 2' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    const tasks = await listTasks({ config: kaneoConfig, projectId })
    expect(tasks.length).toBeGreaterThanOrEqual(2)
  })

  test('task dependencies workflow', async () => {
    const parentTask = await createTask({ config: kaneoConfig, projectId, title: 'Parent task' })
    const childTask = await createTask({ config: kaneoConfig, projectId, title: 'Child task' })
    testClient.trackTask(parentTask.id)
    testClient.trackTask(childTask.id)

    await addTaskRelation({ config: kaneoConfig, taskId: childTask.id, relatedTaskId: parentTask.id, type: 'parent' })

    const childWithRel = await getTask({ config: kaneoConfig, taskId: childTask.id })
    expect(childWithRel.description).toContain('parent:')
  })

  test('bulk operations workflow', async () => {
    const tasks: Array<{ id: string }> = []
    for (let i = 1; i <= 5; i++) {
      const task = await createTask({ config: kaneoConfig, projectId, title: `Bulk task ${i}` })
      tasks.push(task)
      testClient.trackTask(task.id)
    }

    await Promise.all(
      tasks.map((task, index) =>
        updateTask({ config: kaneoConfig, taskId: task.id, priority: index < 3 ? 'high' : 'medium' }),
      ),
    )

    const projectTasks = await listTasks({ config: kaneoConfig, projectId })
    expect(projectTasks.length).toBeGreaterThanOrEqual(5)
  })

  test('task handoff workflow', async () => {
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: 'Task for handoff',
      description: 'Initial requirements',
    })
    testClient.trackTask(task.id)

    await updateTask({ config: kaneoConfig, taskId: task.id, description: 'Updated with technical notes' })
    await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Handing off to QA' })
    await updateTask({ config: kaneoConfig, taskId: task.id, status: 'in_review' })

    const finalTask = await getTask({ config: kaneoConfig, taskId: task.id })
    expect(finalTask.status).toBe('in_review')
  })
})
