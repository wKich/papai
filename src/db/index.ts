import { Database } from 'bun:sqlite'

import { logger } from '../logger.js'
import { runMigrations } from './migrate.js'
import { migration001Initial } from './migrations/001_initial.js'
import { migration002ConversationHistory } from './migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from './migrations/003_multiuser_support.js'
import { migration004MigratedIssues } from './migrations/004_migrated_issues.js'

export const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'

let dbInstance: Database | undefined

export const getDb = (): Database => {
  if (dbInstance === undefined) {
    dbInstance = new Database(DB_PATH)
    // WAL mode is set here rather than in migrations because it must be
    // configured per-database-connection, not per-database-file. This ensures
    // WAL is active immediately on first connection, before any migrations run.
    dbInstance.run('PRAGMA journal_mode=WAL')
    dbInstance.run('PRAGMA foreign_keys=ON')
    logger.info({ dbPath: DB_PATH }, 'Database connection created')
  }
  return dbInstance
}

export const closeDb = (): void => {
  if (dbInstance !== undefined) {
    dbInstance.close()
    dbInstance = undefined
    logger.info({ dbPath: DB_PATH }, 'Database connection closed')
  }
}

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004MigratedIssues,
] as const

export const initDb = (): void => {
  runMigrations(getDb(), MIGRATIONS)
}
