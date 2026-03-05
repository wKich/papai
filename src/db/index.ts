import { Database } from 'bun:sqlite'

import { runMigrations } from './migrate.js'
import { migration001Initial } from './migrations/001_initial.js'
import { migration002ConversationHistory } from './migrations/002_conversation_history.js'

export const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'

let dbInstance: Database | undefined

export const getDb = (): Database => {
  if (dbInstance === undefined) {
    dbInstance = new Database(DB_PATH)
    dbInstance.run('PRAGMA journal_mode=WAL')
  }
  return dbInstance
}

const MIGRATIONS = [migration001Initial, migration002ConversationHistory] as const

export const initDb = (): void => {
  runMigrations(getDb(), MIGRATIONS)
}
