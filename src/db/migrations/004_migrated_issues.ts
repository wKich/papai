import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration004MigratedIssues: Migration = {
  id: '004_migrated_issues',
  up(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS migrated_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        linear_issue_id TEXT NOT NULL,
        huly_issue_id TEXT NOT NULL,
        migrated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(user_id, linear_issue_id)
      )
    `)

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_migrated_issues_user_linear
      ON migrated_issues(user_id, linear_issue_id)
    `)

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_migrated_issues_linear
      ON migrated_issues(linear_issue_id)
    `)
  },
}
