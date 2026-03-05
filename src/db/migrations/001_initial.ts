import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration001Initial: Migration = {
  id: '001_initial',
  up(db: Database): void {
    db.run('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  },
}
