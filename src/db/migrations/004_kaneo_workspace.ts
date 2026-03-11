import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration004KaneoWorkspace: Migration = {
  id: '004_kaneo_workspace',
  up(db: Database): void {
    db.run('ALTER TABLE users ADD COLUMN kaneo_workspace_id TEXT')
    db.run('DROP TABLE IF EXISTS config')
  },
}
