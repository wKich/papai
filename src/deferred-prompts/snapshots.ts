import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { taskSnapshots } from '../db/schema.js'
import { logger } from '../logger.js'
import type { Task } from '../providers/types.js'

const log = logger.child({ scope: 'deferred:snapshots' })

const SNAPSHOT_FIELDS: Array<{ field: string; extract: (task: Task) => string | null }> = [
  { field: 'status', extract: (t) => t.status ?? null },
  { field: 'priority', extract: (t) => t.priority ?? null },
  { field: 'assignee', extract: (t) => t.assignee ?? null },
  { field: 'dueDate', extract: (t) => t.dueDate ?? null },
  { field: 'project', extract: (t) => t.projectId ?? null },
]

/** Capture snapshot of a single task's fields. */
export function captureSnapshot(userId: string, task: Task): void {
  log.debug({ userId, taskId: task.id }, 'Capturing snapshot')
  const db = getDrizzleDb()
  const now = new Date().toISOString()

  for (const { field, extract } of SNAPSHOT_FIELDS) {
    const value = extract(task)
    if (value !== null) {
      db.insert(taskSnapshots)
        .values({ userId, taskId: task.id, field, value })
        .onConflictDoUpdate({
          target: [taskSnapshots.userId, taskSnapshots.taskId, taskSnapshots.field],
          set: { value, capturedAt: now },
        })
        .run()
    }
  }
}

/** Get all snapshots for a user as a Map<string, string>. Key format: "${taskId}:${fieldName}". */
export function getSnapshotsForUser(userId: string): Map<string, string> {
  log.debug({ userId }, 'Getting snapshots for user')
  const db = getDrizzleDb()

  const rows = db.select().from(taskSnapshots).where(eq(taskSnapshots.userId, userId)).all()

  const result = new Map<string, string>()
  for (const row of rows) {
    result.set(`${row.taskId}:${row.field}`, row.value)
  }
  return result
}

/** Capture snapshots for multiple tasks. */
export function updateSnapshots(userId: string, tasks: Task[]): void {
  log.debug({ userId, taskCount: tasks.length }, 'Updating snapshots')
  for (const task of tasks) {
    captureSnapshot(userId, task)
  }
}
