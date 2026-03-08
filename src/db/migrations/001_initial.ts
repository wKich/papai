import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration001Initial: Migration = {
  id: '001_initial',
  up(db: Database): void {
    db.run('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

    db.run(`
      CREATE TABLE IF NOT EXISTS migration_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
        started_at INTEGER,
        completed_at INTEGER,
        error_message TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)

    db.run(`
      INSERT OR IGNORE INTO migration_status (migration_name, status)
      VALUES ('linear_to_huly', 'pending')
    `)
  },
}
