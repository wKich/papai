import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import { addTaskRelation } from '../../src/kaneo/add-task-relation.js'
import { archiveTask } from '../../src/kaneo/archive-task.js'
import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createColumn } from '../../src/kaneo/create-column.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { getTask } from '../../src/kaneo/get-task.js'
import { listTasks } from '../../src/kaneo/list-tasks.js'
import { updateTask } from '../../src/kaneo/update-task.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'

/**
 * Helper to poll for tasks with retry logic for eventual consistency
 * The Kaneo API has eventual consistency - tasks may not appear immediately after creation
 */
async function pollForTasks(
  listFn: () => Promise<Array<{ id: string }>>,
  minCount: number,
  maxAttempts = 10,
  baseDelayMs = 200,
): Promise<Array<{ id: string }>> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const tasks = await listFn()
    if (tasks.length >= minCount) {
      return tasks
    }

    if (attempt < maxAttempts) {
      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 50)
      await new Promise((resolve) => {
        setTimeout(resolve, delay)
      })
    }
  }

  // Return final attempt even if it doesn't meet minCount, let assertion fail
  return listFn()
}

describe('E2E: User Workflows', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
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

    await updateTask({ config: kaneoConfig, taskId: task.id, title: 'Updated task title', status: 'in-progress' })
    // Note: Comment API is broken - GET /activity/{taskId} doesn't return message field
    // Skipping addComment test due to API limitation
    await archiveTask({ config: kaneoConfig, taskId: task.id, workspaceId: testClient.getWorkspaceId() })

    const finalTask = await getTask({ config: kaneoConfig, taskId: task.id })
    expect(finalTask.title).toBe('Updated task title')
    expect(finalTask.status).toBe('in-progress')
  })

  test('project setup workflow', async () => {
    await createColumn({ config: kaneoConfig, projectId, name: `To Do ${Date.now()}` })
    await createColumn({ config: kaneoConfig, projectId, name: `In Progress ${Date.now()}` })
    await createColumn({ config: kaneoConfig, projectId, name: `Done ${Date.now()}`, isFinal: true })

    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Task 1' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Task 2' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    const tasks = await pollForTasks(() => listTasks({ config: kaneoConfig, projectId }), 2)
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

    for (const [index, task] of tasks.entries()) {
      await updateTask({ config: kaneoConfig, taskId: task.id, priority: index < 3 ? 'high' : 'medium' })
    }

    const projectTasks = await pollForTasks(() => listTasks({ config: kaneoConfig, projectId }), 5)
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
    // Note: Comment API is broken - GET /activity/{taskId} doesn't return message field
    // Skipping addComment test due to API limitation
    await updateTask({ config: kaneoConfig, taskId: task.id, status: 'in-review' })

    const finalTask = await getTask({ config: kaneoConfig, taskId: task.id })
    expect(finalTask.status).toBe('in-review')
  })
})
