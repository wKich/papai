import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { addComment } from '../../src/kaneo/add-comment.js'
import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { getComments } from '../../src/kaneo/get-comments.js'
import { removeComment } from '../../src/kaneo/remove-comment.js'
import { updateComment } from '../../src/kaneo/update-comment.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'
import { setupE2EEnvironment, teardownE2EEnvironment } from './setup.js'

describe('E2E: Task Comments', () => {
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
    const project = await testClient.createTestProject(`Comments Test ${Date.now()}`)
    projectId = project.id
  })

  test('adds a comment to a task', async () => {
    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task with comment' })
    testClient.trackTask(task.id)

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'This is a test comment' })

    expect(comment.comment).toBe('This is a test comment')
    expect(comment.id).toBeDefined()
    expect(comment.createdAt).toBeDefined()
  })

  test('retrieves comments for a task', async () => {
    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task with multiple comments' })
    testClient.trackTask(task.id)

    await addComment({ config: kaneoConfig, taskId: task.id, comment: 'First comment' })
    await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Second comment' })

    const comments = await getComments({ config: kaneoConfig, taskId: task.id })

    expect(comments.length).toBeGreaterThanOrEqual(2)
    const commentTexts = comments.map((c) => c.comment)
    expect(commentTexts).toContain('First comment')
    expect(commentTexts).toContain('Second comment')
  })

  test('updates a comment', async () => {
    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task with updatable comment' })
    testClient.trackTask(task.id)

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Original text' })
    const updated = await updateComment({ config: kaneoConfig, activityId: comment.id, comment: 'Updated text' })

    expect(updated.comment).toBe('Updated text')

    const comments = await getComments({ config: kaneoConfig, taskId: task.id })
    const found = comments.find((c) => c.id === comment.id)
    expect(found?.comment).toBe('Updated text')
  })

  test('removes a comment', async () => {
    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task with removable comment' })
    testClient.trackTask(task.id)

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'To be deleted' })
    await removeComment({ config: kaneoConfig, activityId: comment.id })

    const comments = await getComments({ config: kaneoConfig, taskId: task.id })
    const found = comments.find((c) => c.id === comment.id)
    expect(found).toBeUndefined()
  })

  test('handles long comments', async () => {
    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task with long comment' })
    testClient.trackTask(task.id)

    const longComment = 'A'.repeat(1000)
    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: longComment })

    expect(comment.comment).toBe(longComment)
  })

  test('handles special characters in comments', async () => {
    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task with special chars' })
    testClient.trackTask(task.id)

    const specialComment = 'Comment with émojis 🎉 and <html> & "quotes"'
    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: specialComment })

    expect(comment.comment).toBe(specialComment)
  })
})
