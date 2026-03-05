import type { Database } from 'bun:sqlite'

import { logger } from '../logger.js'

export interface Migration {
  readonly id: string
  up(db: Database): void
}

const validateOrder = (migrations: readonly Migration[]): void => {
  for (let i = 1; i < migrations.length; i++) {
    const current = migrations[i]!
    const previous = migrations[i - 1]!
    // Compare by numeric prefix first, then lexicographically for same prefix
    const currentNum = parseInt(current.id.match(/^\d+/)?.[0] ?? '0', 10)
    const previousNum = parseInt(previous.id.match(/^\d+/)?.[0] ?? '0', 10)
    if (currentNum < previousNum || (currentNum === previousNum && current.id <= previous.id)) {
      logger.error(
        { current: current.id, previous: previous.id },
        'Migration order violation: migrations must be in ascending order',
      )
      throw new Error(`Migration ${current.id} is out of order`)
    }
  }
}

const createMigrationsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

const getAppliedIds = (db: Database): Set<string> =>
  new Set(
    db
      .query<{ id: string }, []>(`SELECT id FROM migrations`)
      .all()
      .map((row) => row.id),
  )

const applyMigration = (db: Database, migration: Migration): void => {
  logger.debug({ migrationId: migration.id }, 'Applying migration')

  try {
    // NOTE: PRAGMAs cannot run inside transactions and will be silently ignored.
    // If you need PRAGMA settings (like WAL mode), configure them at connection
    // time in src/db/index.ts, not inside migration up() functions.
    db.transaction(() => {
      migration.up(db)

      const appliedAt = new Date().toISOString()
      db.run(`INSERT INTO migrations (id, applied_at) VALUES (?, ?)`, [migration.id, appliedAt])
    })()

    logger.debug({ migrationId: migration.id }, 'Migration applied successfully')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error({ migrationId: migration.id, error: errorMessage }, 'Migration failed')
    throw error
  }
}

export const runMigrations = (db: Database, migrations: readonly Migration[]): void => {
  logger.debug({ migrationCount: migrations.length }, 'Starting migrations')

  validateOrder(migrations)
  createMigrationsTable(db)

  const appliedIds = getAppliedIds(db)
  const pendingMigrations = migrations.filter((m) => !appliedIds.has(m.id))

  if (pendingMigrations.length === 0) {
    logger.info({ pending: 0, alreadyApplied: appliedIds.size }, 'No pending migrations')
    return
  }

  for (const migration of pendingMigrations) {
    applyMigration(db, migration)
  }

  logger.info({ appliedCount: pendingMigrations.length }, 'Migrations complete')
}
