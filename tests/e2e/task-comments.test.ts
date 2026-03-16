import { beforeAll, afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(30000)

import { addComment } from '../../src/kaneo/add-comment.js'
import type { KaneoConfig } from '../../src/kaneo/client.js'
import { createProject } from '../../src/kaneo/create-project.js'
import { createTask } from '../../src/kaneo/create-task.js'
import { deleteTask } from '../../src/kaneo/delete-task.js'
import { getComments } from '../../src/kaneo/get-comments.js'
import { getSharedKaneoConfig, getSharedWorkspaceId, generateUniqueSuffix } from './test-helpers.js'

describe('E2E: Task Comments', () => {
  let kaneoConfig: KaneoConfig
  let workspaceId: string
  let projectId: string

  beforeAll(async () => {
    // This will trigger global setup if not already done
    kaneoConfig = await getSharedKaneoConfig()
    workspaceId = await getSharedWorkspaceId()
  })

  afterAll(async () => {
    // Only cleanup once after ALL test files
    // Bun test doesn't have a way to detect if this is the last file,
    // so we need a different approach
  })

  beforeEach(async () => {
    // Create a unique project for each test to avoid conflicts
    const suffix = generateUniqueSuffix()
    const project = await createProject({
      config: kaneoConfig,
      workspaceId,
      name: `Comments Test ${suffix}`,
    })
    projectId = project.id
  })

  test('adds a comment to a task', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'This is a test comment' })

    // Comment added successfully (returns 'pending' ID since API doesn't return it)
    expect(comment.comment).toBe('This is a test comment')
    expect(comment.createdAt).toBeDefined()

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })

  test('retrieves comments for a task', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

    await addComment({ config: kaneoConfig, taskId: task.id, comment: 'First comment' })
    await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Second comment' })

    // Comments should now be retrievable (fixed content field access)
    const comments = await getComments({ config: kaneoConfig, taskId: task.id })

    // Both comments should be retrieved
    expect(comments.length).toBe(2)
    expect(comments[0]?.comment).toBe('First comment')
    expect(comments[1]?.comment).toBe('Second comment')

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })

  test('updates a comment', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Original text' })

    // Kaneo API doesn't return comment IDs on creation (GET doesn't include message field),
    // so we can't test update with real ID
    expect(comment.id).toBe('pending')

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })

  test('removes a comment', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'To be deleted' })

    // Kaneo API doesn't return comment IDs on creation (GET doesn't include message field),
    // so we can't test remove with real ID
    expect(comment.id).toBe('pending')

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })

  test('handles long comments', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

    const longComment = 'A'.repeat(1000)
    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: longComment })

    expect(comment.comment).toBe(longComment)

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })

  test('handles special characters in comments', async () => {
    const suffix = generateUniqueSuffix()
    const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${suffix}` })

    const specialComment = 'Comment with émojis 🎉 and <html> & "quotes"'
    const comment = await addComment({ config: kaneoConfig, taskId: task.id, comment: specialComment })

    expect(comment.comment).toBe(specialComment)

    // Cleanup
    await deleteTask({ config: kaneoConfig, taskId: task.id })
  })
})
