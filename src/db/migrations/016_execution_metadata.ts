import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration016ExecutionMetadata: Migration = {
  id: '016_execution_metadata',
  up(db: Database): void {
    db.run(`ALTER TABLE scheduled_prompts ADD COLUMN execution_metadata TEXT NOT NULL DEFAULT '{}'`)
    db.run(`ALTER TABLE alert_prompts ADD COLUMN execution_metadata TEXT NOT NULL DEFAULT '{}'`)
  },
}
