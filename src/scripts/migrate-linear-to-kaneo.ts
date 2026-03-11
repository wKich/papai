// Migration script: Linear → Kaneo. Usage: bun run migrate:linear [--dry-run] [--user <telegram_id>] [--clear-history]

import { logger } from '../logger.js'
import { runMigration, type MigrationStats, type MigrationUserResult } from '../migration.js'

const log = logger.child({ scope: 'migrate-l2k' })

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const clearHistory = args.includes('--clear-history')
const userFlagIdx = args.indexOf('--user')
const singleUserId = userFlagIdx === -1 ? undefined : Number(args[userFlagIdx + 1])

function printSummary(results: MigrationUserResult[]): void {
  console.log('\n=== Migration Summary ===\n')
  for (const r of results) {
    const label = r.username === null ? String(r.userId) : `@${r.username} (${r.userId})`
    console.log(`${label}: ${r.status}`)
    if (r.stats !== undefined) {
      const s: MigrationStats = r.stats
      console.log(`  Labels: ${s.labels}, Projects: ${s.projects}, Columns: ${s.columns}`)
      console.log(`  Tasks: ${s.tasks}, Comments: ${s.comments}, Relations patched: ${s.relations}`)
      console.log(`  Archived: ${s.archived}`)
    }
  }
  console.log()
}

async function main(): Promise<void> {
  log.info({ dryRun, clearHistory, singleUserId }, 'Migration started')
  const results = await runMigration({ dryRun, clearHistory, singleUserId })
  printSummary(results)
}

main().catch((error: unknown) => {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Migration script failed')
  process.exit(1)
})
