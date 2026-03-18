/**
 * End-to-end migration test: Linear → self-hosted Kaneo
 *
 * Spins up Kaneo (postgres + API) via docker compose, registers a test user,
 * creates a workspace, runs the full migration from Linear, then verifies
 * the imported data matches.
 *
 * Usage:
 *   bun run test:migration --linear-key <key> --linear-team <team-id>
 *
 * Optionally:
 *   --keep    Do not tear down docker containers after the test
 *   --skip-up Skip docker compose up (assume services are already running)
 */

import { logger } from '../logger.js'
import type { KaneoConfig } from '../providers/kaneo/client.js'
import type { LinearConfig } from './linear-client.js'
import { KANEO_BASE_URL } from './test-migration-constants.js'
import { composeDown, composeUp, createWorkspace, signUp, waitForKaneo } from './test-migration-infra.js'
import { runMigration } from './test-migration-migrate.js'
import { verify } from './test-migration-verify.js'

const log = logger.child({ scope: 'test-migration' })

// --- CLI args ---

const args = process.argv.slice(2)

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx === -1 ? undefined : args[idx + 1]
}

const linearKey = getArg('--linear-key') ?? process.env['LINEAR_API_KEY']
const linearTeamId = getArg('--linear-team') ?? process.env['LINEAR_TEAM_ID']
const keepContainers = args.includes('--keep')
const skipUp = args.includes('--skip-up')

if (linearKey === undefined || linearTeamId === undefined) {
  console.error('Usage: bun run test:migration --linear-key <key> --linear-team <team-id>')
  console.error('  Or set LINEAR_API_KEY and LINEAR_TEAM_ID env vars.')
  process.exit(1)
}

// --- Constants ---

export { KANEO_PORT, COMPOSE_PROJECT, POSTGRES_PASSWORD, AUTH_SECRET } from './test-migration-constants.js'

// --- Main ---

function printStats(stats: Record<string, number>): void {
  console.log('\n--- Migration Stats ---')
  for (const [key, value] of Object.entries(stats)) {
    console.log(`  ${key}: ${value}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== Linear → Kaneo Migration E2E Test ===\n')

  const linearConfig: LinearConfig = { apiKey: linearKey!, teamId: linearTeamId! }

  try {
    if (!skipUp) await composeUp()
    await waitForKaneo()

    const auth = await signUp()
    const kaneoConfig: KaneoConfig = { apiKey: '', baseUrl: KANEO_BASE_URL, sessionCookie: auth.sessionCookie }
    const workspace = await createWorkspace(auth.sessionCookie)

    console.log('\n--- Running migration ---\n')
    const migration = await runMigration(linearConfig, kaneoConfig, workspace.id)
    printStats(migration.stats)

    console.log('\n--- Verification ---\n')
    const result = await verify(kaneoConfig, workspace.id, migration)

    console.log('\n--- Results ---\n')
    for (const c of result.checks) {
      console.log(`  [${c.passed ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`)
    }

    console.log()
    if (result.passed) {
      console.log('All checks passed!')
    } else {
      console.log('Some checks failed.')
      process.exitCode = 1
    }
  } finally {
    if (!keepContainers && !skipUp) await composeDown()
  }
}

main().catch((error: unknown) => {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'E2E test failed')
  console.error('\nE2E test crashed:', error instanceof Error ? error.message : String(error))
  if (!keepContainers && !skipUp) composeDown().catch(() => {})
  process.exit(1)
})
