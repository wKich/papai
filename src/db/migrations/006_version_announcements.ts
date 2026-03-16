import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration006VersionAnnouncements: Migration = {
  id: '006_version_announcements',
  up(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS version_announcements (
        version TEXT PRIMARY KEY,
        announced_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  },
}
