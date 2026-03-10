/**
 * Standalone migration runner — no Telegram required.
 * Usage:
 *   bun src/migration/run.ts           # skip if already complete
 *   bun src/migration/run.ts --reset   # reset status and re-run
 */

import { closeDb, getDb, initDb } from '../db/index.js'
import { setMigrationStatus } from '../db/migration-status.js'
import { logger } from '../logger.js'
import { runLinearToHulyMigration } from './migrate.js'

const log = logger.child({ scope: 'migration:run' })

if ((process.env['HULY_URL'] ?? '') === '' || (process.env['HULY_WORKSPACE'] ?? '') === '') {
  log.error('HULY_URL and HULY_WORKSPACE must be set')
  process.exit(1)
}

initDb()

if (process.argv.includes('--reset')) {
  log.info('Resetting migration status')
  getDb().run('DELETE FROM migrated_issues')
  setMigrationStatus('linear_to_huly', 'pending')
}

const result = await runLinearToHulyMigration()

log.info({ success: result.success, migratedCount: result.migratedCount, errors: result.errors }, 'Migration finished')

closeDb()
process.exit(result.success ? 0 : 1)
