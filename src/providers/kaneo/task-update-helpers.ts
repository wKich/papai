import { z } from 'zod'

import { type KaneoConfig, kaneoFetch } from './client.js'
import { TaskSchema } from './schemas/createTask.js'
import { denormalizeStatus } from './task-status.js'

// Local schema for task with projectId (for update responses)
const TaskWithProjectIdSchema = TaskSchema

const FullTaskSchema = TaskWithProjectIdSchema.extend({
  position: z.number(),
})

type TaskUpdateParams = {
  title?: string
  description?: string
  status?: string
  priority?: string
  dueDate?: string
  projectId?: string
  userId?: string
}

/**
 * Single field update for a task
 */
function singleFieldUpdate(
  config: KaneoConfig,
  taskId: string,
  field: string,
  value: unknown,
): Promise<z.infer<typeof TaskWithProjectIdSchema>> {
  const endpoints: Record<string, { path: string; key: string }> = {
    status: { path: '/task/status/', key: 'status' },
    priority: { path: '/task/priority/', key: 'priority' },
    userId: { path: '/task/assignee/', key: 'userId' },
    dueDate: { path: '/task/due-date/', key: 'dueDate' },
    title: { path: '/task/title/', key: 'title' },
    description: { path: '/task/description/', key: 'description' },
  }
  const endpoint = endpoints[field]
  if (endpoint === undefined) throw new Error(`Unknown field: ${field}`)
  return kaneoFetch(
    config,
    'PUT',
    `${endpoint.path}${taskId}`,
    { [endpoint.key]: value },
    undefined,
    TaskWithProjectIdSchema,
  )
}

/**
 * Perform updates on a task, handling multiple field updates sequentially
 */
export async function performUpdate(
  config: KaneoConfig,
  taskId: string,
  params: TaskUpdateParams,
): Promise<z.infer<typeof TaskWithProjectIdSchema>> {
  // Use single-field endpoints for each field being updated
  // (The full /task/:id endpoint doesn't actually update fields)
  const setFields = Object.entries(params).filter(([, v]) => v !== undefined)

  // Apply updates sequentially using reduce to chain promises
  // This avoids await-in-loop while maintaining sequential execution
  const result = await setFields.reduce<Promise<z.infer<typeof TaskWithProjectIdSchema> | undefined>>(
    async (previousPromise, [field, value]) => {
      await previousPromise
      return singleFieldUpdate(config, taskId, field, value)
    },
    Promise.resolve(undefined),
  )

  // Return the result, or fetch current if no updates
  if (result !== undefined) {
    // Denormalize status from column ID to slug
    if (result.projectId !== undefined) {
      result.status = await denormalizeStatus(config, result.projectId, result.status)
    }
    return result
  }

  // If no fields to update, just return current task
  const task = await kaneoFetch(config, 'GET', `/task/${taskId}`, undefined, undefined, FullTaskSchema)
  // Denormalize status from column ID to slug
  if (task.projectId !== undefined) {
    task.status = await denormalizeStatus(config, task.projectId, task.status)
  }
  return task
}
