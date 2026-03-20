import { Database } from 'bun:sqlite'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from './schema.js'

const DB_PATH = process.env['DB_PATH'] ?? 'papai.db'

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined

export const getDrizzleDb = (): ReturnType<typeof drizzle<typeof schema>> => {
  if (dbInstance === undefined) {
    const sqlite = new Database(DB_PATH)
    // WAL mode and foreign keys are set in existing getDb, keep for compatibility
    sqlite.run('PRAGMA journal_mode=WAL')
    sqlite.run('PRAGMA foreign_keys=ON')
    dbInstance = drizzle(sqlite, { schema })
  }
  return dbInstance
}

export const closeDrizzleDb = (): void => {
  if (dbInstance !== undefined) {
    dbInstance = undefined
  }
}

/**
 * Reset the Drizzle DB instance. Useful for testing.
 * @internal
 */
export const _resetDrizzleDb = (): void => {
  dbInstance = undefined
}

/**
 * Set a custom Drizzle DB instance. Useful for testing with in-memory DB.
 * @internal
 */
export const _setDrizzleDb = (db: ReturnType<typeof drizzle<typeof schema>>): void => {
  dbInstance = db
}
