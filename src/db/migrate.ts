import type { Database } from 'bun:sqlite'

import { logger } from '../logger.js'

export interface Migration {
  readonly id: string
  up(db: Database): void
}

export const runMigrations = (db: Database, migrations: readonly Migration[]): void => {
  logger.debug({ migrationCount: migrations.length }, 'Starting migrations')

  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  const appliedIds = new Set(
    db
      .query<{ id: string }, []>(`SELECT id FROM migrations`)
      .all()
      .map((row) => row.id),
  )

  const pendingMigrations = migrations.filter((m) => !appliedIds.has(m.id))

  if (pendingMigrations.length === 0) {
    logger.info({ appliedCount: 0 }, 'No pending migrations')
    return
  }

  for (const migration of pendingMigrations) {
    logger.debug({ migrationId: migration.id }, 'Applying migration')

    try {
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

  logger.info({ appliedCount: pendingMigrations.length }, 'Migrations complete')
}
