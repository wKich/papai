import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration015DropBackgroundEvents: Migration = {
  id: '015_drop_background_events',
  up(db: Database): void {
    db.run('DROP TABLE IF EXISTS background_events')
  },
}
