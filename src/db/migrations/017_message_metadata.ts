import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration017MessageMetadata: Migration = {
  id: '017_message_metadata',
  up(db: Database): void {
    db.run(`
      CREATE TABLE message_metadata (
        message_id TEXT PRIMARY KEY,
        context_id TEXT NOT NULL,
        author_id TEXT,
        author_username TEXT,
        text TEXT,
        reply_to_message_id TEXT,
        timestamp INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `)
    db.run(`CREATE INDEX idx_message_metadata_context_id ON message_metadata(context_id)`)
    db.run(`CREATE INDEX idx_message_metadata_expires_at ON message_metadata(expires_at)`)
    db.run(`CREATE INDEX idx_message_metadata_reply_to ON message_metadata(reply_to_message_id)`)
  },
}
