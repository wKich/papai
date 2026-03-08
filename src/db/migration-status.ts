import type { Database } from 'bun:sqlite'

import { logger } from '../logger.js'
import { getDb } from './index.js'

const log = logger.child({ scope: 'migration-status' })

export type MigrationName = 'linear_to_huly'
export type MigrationStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export function getMigrationStatus(migrationName: MigrationName, db?: Database): MigrationStatus {
  log.debug({ migrationName }, 'Getting migration status')
  const database = db ?? getDb()
  const row = database
    .query<{ status: MigrationStatus }, [string]>('SELECT status FROM migration_status WHERE migration_name = ?')
    .get(migrationName)

  if (!row) {
    log.warn({ migrationName }, 'Migration status not found, returning pending')
    return 'pending'
  }

  return row.status
}

export function setMigrationStatus(
  migrationName: MigrationName,
  status: MigrationStatus,
  errorMessage?: string,
  db?: Database,
): void {
  log.info({ migrationName, status }, 'Setting migration status')
  const database = db ?? getDb()

  if (status === 'completed') {
    database.run(
      `UPDATE migration_status 
       SET status = ?, completed_at = unixepoch(), error_message = NULL 
       WHERE migration_name = ?`,
      [status, migrationName],
    )
  } else if (status === 'failed' && errorMessage !== undefined) {
    database.run(
      `UPDATE migration_status 
       SET status = ?, error_message = ? 
       WHERE migration_name = ?`,
      [status, errorMessage, migrationName],
    )
  } else if (status === 'in_progress') {
    database.run(
      `UPDATE migration_status 
       SET status = ?, started_at = unixepoch(), error_message = NULL 
       WHERE migration_name = ?`,
      [status, migrationName],
    )
  } else {
    database.run('UPDATE migration_status SET status = ? WHERE migration_name = ?', [status, migrationName])
  }
}

export function isMigrationComplete(migrationName: MigrationName, db?: Database): boolean {
  return getMigrationStatus(migrationName, db) === 'completed'
}
