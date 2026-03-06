import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'migrate' })

export function migrateToMultiUser(adminId: number): void {
  log.debug({ adminId }, 'migrateToMultiUser called')

  const db = getDb()

  // Seed admin user (idempotent)
  db.run('INSERT INTO users (telegram_id, added_by) VALUES (?, ?) ON CONFLICT DO NOTHING', [adminId, adminId])
  log.info({ adminId }, 'Admin user seeded')

  // Check if old config table exists
  const tableRow = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='config'")
    .get()

  if (tableRow === null) {
    log.debug('No legacy config table found, skipping migration')
    return
  }

  // Copy rows from config to user_config for the admin user (won't overwrite existing)
  const rows = db.query<{ key: string; value: string }, []>('SELECT key, value FROM config').all()
  for (const row of rows) {
    db.run('INSERT OR IGNORE INTO user_config (user_id, key, value) VALUES (?, ?, ?)', [adminId, row.key, row.value])
  }
  log.info({ adminId, migratedKeys: rows.length }, 'Legacy config migrated to user_config')
}
