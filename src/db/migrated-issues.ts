import type { Database } from 'bun:sqlite'

import { logger } from '../logger.js'
import { getDb } from './index.js'

const log = logger.child({ scope: 'migrated-issues' })

export function isIssueMigrated(userId: number, linearIssueId: string, db?: Database): boolean {
  log.debug({ userId, linearIssueId }, 'Checking if issue is already migrated')
  const database = db ?? getDb()
  const row = database
    .query<{ count: number }, [number, string]>(
      'SELECT COUNT(*) as count FROM migrated_issues WHERE user_id = ? AND linear_issue_id = ?',
    )
    .get(userId, linearIssueId)

  const isMigrated = row !== undefined && row !== null && row.count > 0
  log.debug({ userId, linearIssueId, isMigrated }, 'Migration check result')
  return isMigrated
}

export function recordMigratedIssue(userId: number, linearIssueId: string, hulyIssueId: string, db?: Database): void {
  log.info({ userId, linearIssueId, hulyIssueId }, 'Recording migrated issue')
  const database = db ?? getDb()
  database.run('INSERT OR IGNORE INTO migrated_issues (user_id, linear_issue_id, huly_issue_id) VALUES (?, ?, ?)', [
    userId,
    linearIssueId,
    hulyIssueId,
  ])
}

export function getMigratedIssueCount(userId: number, db?: Database): number {
  const database = db ?? getDb()
  const row = database
    .query<{ count: number }, [number]>('SELECT COUNT(*) as count FROM migrated_issues WHERE user_id = ?')
    .get(userId)

  return row?.count ?? 0
}
