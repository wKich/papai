import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration022DropUnusedLastSeenIndex: Migration = {
  id: '022_drop_unused_last_seen_index',
  up(db: Database): void {
    db.run(`DROP INDEX IF EXISTS idx_known_group_contexts_last_seen`)
  },
}
