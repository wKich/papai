import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const createAuthorizedGroupsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE authorized_groups (
      group_id TEXT PRIMARY KEY,
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run('CREATE INDEX idx_authorized_groups_added_by ON authorized_groups(added_by)')
}

export const migration024AuthorizedGroups: Migration = {
  id: '024_authorized_groups',
  up(db: Database): void {
    createAuthorizedGroupsTable(db)
  },
}
