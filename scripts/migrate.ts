#!/usr/bin/env bun
/**
 * Standalone migration script for Linear to Huly
 * Can be run manually: bun run scripts/migrate.ts
 */

import { getDb } from '../src/db/index.js'
import { runMigrations } from '../src/db/migrate.js'
import { setMigrationStatus } from '../src/db/migration-status.js'
import { logger } from '../src/logger.js'
import { runLinearToHulyMigration } from '../src/migration/migrate.js'

async function main(): Promise<void> {
  logger.info('Starting standalone migration script')

  // Initialize database
  const db = getDb()
  runMigrations(db, [])

  // Reset migration status to force re-run (optional, for retries)
  const shouldReset = process.argv.includes('--reset')
  if (shouldReset) {
    logger.info('Resetting migration status')
    setMigrationStatus('linear_to_huly', 'pending')
  }

  // Run migration
  const result = await runLinearToHulyMigration()

  if (result.success) {
    logger.info({ migratedCount: result.migratedCount }, 'Migration completed successfully')
    process.exit(0)
  } else {
    logger.error({ errors: result.errors }, 'Migration failed')
    process.exit(1)
  }
}

main().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : String(error)
  logger.error({ error: errorMessage }, 'Unhandled error in migration script')
  process.exit(1)
})
