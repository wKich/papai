import { Database } from 'bun:sqlite'

import { runMigrations } from './migrate.js'
import { migration001Initial } from './migrations/001_initial.js'
import { migration002ConversationHistory } from './migrations/002_conversation_history.js'

export const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'

let dbInstance: Database | undefined

export const getDb = (): Database => {
  if (dbInstance === undefined) {
    dbInstance = new Database(DB_PATH)
    // WAL mode is set here rather than in migrations because it must be
    // configured per-database-connection, not per-database-file. This ensures
    // WAL is active immediately on first connection, before any migrations run.
    dbInstance.run('PRAGMA journal_mode=WAL')
    // Ensure migrations table exists early so any module can safely query it
    // even if initDb() hasn't been called yet.
    dbInstance.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `)
  }
  return dbInstance
}

const MIGRATIONS = [migration001Initial, migration002ConversationHistory] as const

export const initDb = (): void => {
  runMigrations(getDb(), MIGRATIONS)
}
