/**
 * Smoke test for provisionKaneoUser.
 *
 * Spins up kaneo-postgres + kaneo-api via docker compose, calls
 * provisionKaneoUser for two simulated Telegram users, then verifies the
 * returned credentials can actually list projects from the Kaneo API.
 *
 * Usage:
 *   bun run src/scripts/test-provision.ts
 *   bun run src/scripts/test-provision.ts --keep   # leave containers running
 *   bun run src/scripts/test-provision.ts --skip-up # assume services already up
 */

import { z } from 'zod'

import { kaneoFetch } from '../kaneo/client.js'
import { provisionKaneoUser } from '../kaneo/provision.js'
import { logger } from '../logger.js'
import { KANEO_BASE_URL, KANEO_CLIENT_URL } from './test-migration-constants.js'
import { composeDown, composeUp, waitForKaneo } from './test-migration-infra.js'

const log = logger.child({ scope: 'test-provision' })

const args = process.argv.slice(2)
const keepContainers = args.includes('--keep')
const skipUp = args.includes('--skip-up')

// Minimal schema to verify credentials can read projects
const ProjectListSchema = z.array(z.object({ id: z.string(), name: z.string() }))

let passed = 0
let failed = 0

function ok(label: string): void {
  console.log(`  [PASS] ${label}`)
  passed++
}

function fail(label: string, detail: string): void {
  console.log(`  [FAIL] ${label}: ${detail}`)
  failed++
}

async function checkCanListProjects(label: string, kaneoKey: string, workspaceId: string): Promise<void> {
  const isSessionCookie = kaneoKey.startsWith('better-auth.session_token=')
  const config = isSessionCookie
    ? { apiKey: '', baseUrl: KANEO_BASE_URL, sessionCookie: kaneoKey }
    : { apiKey: kaneoKey, baseUrl: KANEO_BASE_URL }
  try {
    await kaneoFetch(config, 'GET', '/project', undefined, { workspaceId }, ProjectListSchema)
    ok(`${label}: list projects with credentials`)
  } catch (err: unknown) {
    fail(`${label}: list projects with credentials`, err instanceof Error ? err.message : String(err))
  }
}

async function runProvisionChecks(): Promise<void> {
  // Case 1: user with a username
  console.log('\n--- Case 1: user with username ---')
  const prov1 = await provisionKaneoUser(KANEO_BASE_URL, KANEO_CLIENT_URL, 111111, 'testuser')
  log.info({ email: prov1.email, workspaceId: prov1.workspaceId }, 'Provisioned user 1')

  if (prov1.email === 'testuser@pap.ai') {
    ok('email derived from username')
  } else {
    fail('email derived from username', prov1.email)
  }
  if (prov1.workspaceId.length > 0) {
    ok('workspaceId is non-empty')
  } else {
    fail('workspaceId is non-empty', 'empty string')
  }
  const isApiKey1 = !prov1.kaneoKey.startsWith('better-auth.session_token=')
  if (isApiKey1) {
    ok('kaneoKey is an API key (not a session cookie)')
  } else {
    console.log(
      '  [WARN] kaneoKey is a session cookie — API key endpoint unavailable on this Kaneo build (fallback is fine)',
    )
  }
  await checkCanListProjects('user 1', prov1.kaneoKey, prov1.workspaceId)

  // Case 2: user without a username
  console.log('\n--- Case 2: user without username (ID only) ---')
  const prov2 = await provisionKaneoUser(KANEO_BASE_URL, KANEO_CLIENT_URL, 222222, null)
  log.info({ email: prov2.email, workspaceId: prov2.workspaceId }, 'Provisioned user 2')

  if (prov2.email === '222222@pap.ai') {
    ok('email derived from telegram ID')
  } else {
    fail('email derived from telegram ID', prov2.email)
  }
  if (prov2.workspaceId.length > 0) {
    ok('workspaceId is non-empty')
  } else {
    fail('workspaceId is non-empty', 'empty string')
  }
  await checkCanListProjects('user 2', prov2.kaneoKey, prov2.workspaceId)

  // Workspaces should be distinct
  if (prov1.workspaceId === prov2.workspaceId) {
    fail('each user gets a separate workspace', 'both got the same workspaceId')
  } else {
    ok('each user gets a separate workspace')
  }
}

async function main(): Promise<void> {
  console.log('\n=== provisionKaneoUser smoke test ===\n')

  try {
    if (!skipUp) await composeUp()
    await waitForKaneo()
    await runProvisionChecks()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('\nFatal error:', msg)
    log.error({ error: msg }, 'Test crashed')
    failed++
  } finally {
    if (!keepContainers && !skipUp) await composeDown()
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`)
  if (failed > 0) process.exit(1)
}

main().catch((err: unknown) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
