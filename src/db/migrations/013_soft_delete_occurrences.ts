import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration013SoftDeleteOccurrences: Migration = {
  id: '013_soft_delete_occurrences',
  up(db: Database): void {
    db.run('ALTER TABLE recurring_task_occurrences ADD COLUMN deleted_at TEXT')
  },
}
