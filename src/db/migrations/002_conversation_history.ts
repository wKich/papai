import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration002ConversationHistory: Migration = {
  id: '002_conversation_history',
  up(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        user_id INTEGER PRIMARY KEY,
        messages TEXT NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS memory_summary (
        user_id INTEGER PRIMARY KEY,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS memory_facts (
        user_id INTEGER NOT NULL,
        identifier TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        last_seen TEXT NOT NULL,
        PRIMARY KEY (user_id, identifier)
      )
    `)
  },
}
