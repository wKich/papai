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

import { $ } from 'bun'

import type { KaneoConfig } from '../kaneo/client.js'
import { kaneoFetch } from '../kaneo/client.js'
import { parseRelationsFromDescription } from '../kaneo/frontmatter.js'
import { logger } from '../logger.js'
import {
  createTaskFromIssue,
  ensureColumns,
  ensureLabels,
  ensureProject,
  type KaneoLabel,
  type KaneoTask,
  patchRelations,
} from './kaneo-import.js'
import {
  fetchAllIssues,
  fetchLabels,
  fetchProjects,
  fetchWorkflowStates,
  type LinearConfig,
  type LinearIssue,
  type LinearProject,
} from './linear-client.js'

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

const KANEO_PORT = 11337
const KANEO_BASE_URL = `http://localhost:${KANEO_PORT}`
const COMPOSE_PROJECT = 'papai-migration-test'
const POSTGRES_PASSWORD = 'test-migration-pw'
const AUTH_SECRET = 'test-migration-secret-at-least-32-chars-long'
const TEST_EMAIL = 'migration-test@example.com'
const TEST_PASSWORD = 'test-password-123'
const TEST_NAME = 'Migration Test'
const WORKSPACE_NAME = 'Migration Test Workspace'

// --- Docker compose helpers ---

async function composeUp(): Promise<void> {
  log.info('Starting Kaneo services via docker compose')
  await $`docker compose -p ${COMPOSE_PROJECT} \
    -f docker-compose.yml \
    up -d kaneo-postgres kaneo-api \
    --wait`.env({
    KANEO_POSTGRES_PASSWORD: POSTGRES_PASSWORD,
    KANEO_AUTH_SECRET: AUTH_SECRET,
    KANEO_API_PORT: String(KANEO_PORT),
    KANEO_CLIENT_URL: `http://localhost:5173`,
    KANEO_API_URL: KANEO_BASE_URL,
  })
  log.info('Docker compose services started')
}

async function composeDown(): Promise<void> {
  log.info('Tearing down docker compose services')
  await $`docker compose -p ${COMPOSE_PROJECT} down -v --remove-orphans`.env({
    KANEO_POSTGRES_PASSWORD: POSTGRES_PASSWORD,
    KANEO_AUTH_SECRET: AUTH_SECRET,
    KANEO_API_PORT: String(KANEO_PORT),
  })
  log.info('Docker compose services torn down')
}

// --- Kaneo health check ---

async function waitForKaneo(maxAttempts = 30): Promise<void> {
  log.info({ maxAttempts }, 'Waiting for Kaneo API to be ready')

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${KANEO_BASE_URL}/api/health`)
      if (res.ok) {
        log.info({ attempt }, 'Kaneo API is ready')
        return
      }
    } catch {
      // not ready yet
    }
    log.debug({ attempt }, 'Kaneo not ready, retrying')
    await Bun.sleep(2000)
  }

  throw new Error('Kaneo API did not become ready in time')
}

// --- Kaneo auth + workspace setup ---

interface AuthSession {
  token: string
  user: { id: string; email: string }
}

interface KaneoWorkspace {
  id: string
  name: string
  slug: string
}

async function signUp(): Promise<AuthSession> {
  log.info({ email: TEST_EMAIL }, 'Registering test user on Kaneo')

  const res = await fetch(`${KANEO_BASE_URL}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Kaneo sign-up failed (${res.status}): ${body}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- response.json() returns unknown, generic cast is intentional
  const data = (await res.json()) as AuthSession
  log.info({ userId: data.user.id }, 'Test user registered')
  return data
}

async function createWorkspace(config: KaneoConfig): Promise<KaneoWorkspace> {
  log.info({ name: WORKSPACE_NAME }, 'Creating test workspace')
  const ws = await kaneoFetch<KaneoWorkspace>(config, 'POST', '/workspace', {
    name: WORKSPACE_NAME,
    slug: 'migration-test',
  })
  log.info({ workspaceId: ws.id }, 'Workspace created')
  return ws
}

// --- Migration (inline, bypassing DB) ---

async function runMigration(
  linearConfig: LinearConfig,
  kaneoConfig: KaneoConfig,
  workspaceId: string,
): Promise<{
  stats: {
    labels: number
    projects: number
    columns: number
    tasks: number
    comments: number
    relations: number
    archived: number
  }
  linearIdToKaneoId: Map<string, string>
  linearIssues: LinearIssue[]
  linearProjects: LinearProject[]
}> {
  log.info('Fetching Linear data')
  const [labels, states, projects, issues] = await Promise.all([
    fetchLabels(linearConfig),
    fetchWorkflowStates(linearConfig),
    fetchProjects(linearConfig),
    fetchAllIssues(linearConfig),
  ])

  log.info(
    { labels: labels.length, states: states.length, projects: projects.length, issues: issues.length },
    'Linear data fetched',
  )

  const stats = { labels: 0, projects: 0, columns: 0, tasks: 0, comments: 0, relations: 0, archived: 0 }

  // Labels
  const labelIdMap = await ensureLabels(kaneoConfig, workspaceId, labels)
  stats.labels = labelIdMap.size

  // Group issues by project
  const issuesByProject = new Map<string | null, LinearIssue[]>()
  for (const issue of issues) {
    const key = issue.project?.id ?? null
    const arr = issuesByProject.get(key) ?? []
    arr.push(issue)
    issuesByProject.set(key, arr)
  }

  const projectNameById = new Map(projects.map((p) => [p.id, p]))
  const linearIdToKaneoId = new Map<string, string>()

  for (const [linearProjectId, projectIssues] of issuesByProject) {
    const lp = linearProjectId === null ? undefined : projectNameById.get(linearProjectId)
    const name = lp?.name ?? (linearProjectId === null ? 'Inbox' : 'Untitled Project')

    // eslint-disable-next-line no-await-in-loop
    const kaneoProjectId = await ensureProject(kaneoConfig, workspaceId, name, lp?.description)
    stats.projects++

    // eslint-disable-next-line no-await-in-loop
    const stateToColumnId = await ensureColumns(kaneoConfig, kaneoProjectId, states)
    stats.columns += stateToColumnId.size

    for (const issue of projectIssues) {
      // eslint-disable-next-line no-await-in-loop
      await createTaskFromIssue(kaneoConfig, kaneoProjectId, workspaceId, issue, labelIdMap, linearIdToKaneoId)
      stats.tasks++
      stats.comments += issue.comments.nodes.length
      if (issue.archivedAt !== null) stats.archived++
    }
  }

  stats.relations = await patchRelations(kaneoConfig, issues, linearIdToKaneoId)

  return { stats, linearIdToKaneoId, linearIssues: issues, linearProjects: projects }
}

// --- Verification ---

interface VerificationResult {
  passed: boolean
  checks: Array<{ name: string; passed: boolean; detail: string }>
}

async function verify(
  kaneoConfig: KaneoConfig,
  workspaceId: string,
  linearIssues: LinearIssue[],
  linearProjects: LinearProject[],
  linearIdToKaneoId: Map<string, string>,
): Promise<VerificationResult> {
  const checks: VerificationResult['checks'] = []

  function check(name: string, passed: boolean, detail: string): void {
    checks.push({ name, passed, detail })
    if (passed) {
      log.info({ check: name }, `PASS: ${detail}`)
    } else {
      log.error({ check: name }, `FAIL: ${detail}`)
    }
  }

  // 1. All issues were mapped
  check(
    'All issues mapped',
    linearIdToKaneoId.size === linearIssues.length,
    `${linearIdToKaneoId.size}/${linearIssues.length} issues have Kaneo IDs`,
  )

  // 2. Verify projects exist in Kaneo
  interface KaneoProject {
    id: string
    name: string
  }
  const kaneoProjects = await kaneoFetch<KaneoProject[]>(kaneoConfig, 'GET', '/project', undefined, { workspaceId })
  const expectedProjectNames = new Set(linearProjects.map((p) => p.name))
  if (linearIssues.some((i) => i.project === null)) {
    expectedProjectNames.add('Inbox')
  }
  const kaneoProjectNames = new Set(kaneoProjects.map((p) => p.name))
  const missingProjects = [...expectedProjectNames].filter((n) => !kaneoProjectNames.has(n))
  check(
    'Projects created',
    missingProjects.length === 0,
    missingProjects.length === 0
      ? `All ${expectedProjectNames.size} projects exist`
      : `Missing: ${missingProjects.join(', ')}`,
  )

  // 3. Verify labels exist
  const kaneoLabels = await kaneoFetch<KaneoLabel[]>(kaneoConfig, 'GET', `/label/workspace/${workspaceId}`)
  check('Labels exist', kaneoLabels.length > 0, `${kaneoLabels.length} labels in workspace`)

  // 4. Spot-check tasks: verify a sample of tasks have correct titles
  const sampleSize = Math.min(5, linearIssues.length)
  const sample = linearIssues.slice(0, sampleSize)
  let titlesMatch = 0
  for (const issue of sample) {
    const kaneoId = linearIdToKaneoId.get(issue.id)
    if (kaneoId === undefined) continue
    // eslint-disable-next-line no-await-in-loop
    const task = await kaneoFetch<KaneoTask>(kaneoConfig, 'GET', `/task/${kaneoId}`)
    if (task.title === issue.title) titlesMatch++
  }
  check(
    'Task titles match',
    titlesMatch === sampleSize,
    `${titlesMatch}/${sampleSize} sampled tasks have correct titles`,
  )

  // 5. Verify relations (check that issues with relations have frontmatter)
  const issuesWithRelations = linearIssues.filter((i) => i.relations.nodes.length > 0 || i.parent !== null)
  let relationsVerified = 0
  const relationSample = issuesWithRelations.slice(0, Math.min(3, issuesWithRelations.length))
  for (const issue of relationSample) {
    const kaneoId = linearIdToKaneoId.get(issue.id)
    if (kaneoId === undefined) continue
    // eslint-disable-next-line no-await-in-loop
    const task = await kaneoFetch<KaneoTask>(kaneoConfig, 'GET', `/task/${kaneoId}`)
    const { relations } = parseRelationsFromDescription(task.description)
    if (relations.length > 0) relationsVerified++
  }
  if (relationSample.length > 0) {
    check(
      'Relations in frontmatter',
      relationsVerified === relationSample.length,
      `${relationsVerified}/${relationSample.length} sampled tasks have frontmatter relations`,
    )
  } else {
    check('Relations in frontmatter', true, 'No issues with relations to verify (skipped)')
  }

  // 6. Verify parent-child relations specifically
  const issuesWithParent = linearIssues.filter((i) => i.parent !== null)
  let parentsVerified = 0
  const parentSample = issuesWithParent.slice(0, Math.min(3, issuesWithParent.length))
  for (const issue of parentSample) {
    const kaneoId = linearIdToKaneoId.get(issue.id)
    if (kaneoId === undefined) continue
    // eslint-disable-next-line no-await-in-loop
    const task = await kaneoFetch<KaneoTask>(kaneoConfig, 'GET', `/task/${kaneoId}`)
    const { relations } = parseRelationsFromDescription(task.description)
    const parentRel = relations.find((r) => r.type === 'parent')
    const expectedParentKaneoId = issue.parent === null ? undefined : linearIdToKaneoId.get(issue.parent.id)
    if (parentRel !== undefined && parentRel.taskId === expectedParentKaneoId) parentsVerified++
  }
  if (parentSample.length > 0) {
    check(
      'Parent relations correct',
      parentsVerified === parentSample.length,
      `${parentsVerified}/${parentSample.length} sub-issues have correct parent relation`,
    )
  } else {
    check('Parent relations correct', true, 'No sub-issues to verify (skipped)')
  }

  // 7. Verify archived tasks have the "archived" label
  const archivedIssues = linearIssues.filter((i) => i.archivedAt !== null)
  if (archivedIssues.length > 0) {
    const archivedSample = archivedIssues.slice(0, Math.min(3, archivedIssues.length))
    let archivedOk = 0
    for (const issue of archivedSample) {
      const kaneoId = linearIdToKaneoId.get(issue.id)
      if (kaneoId === undefined) continue
      // eslint-disable-next-line no-await-in-loop
      const taskLabels = await kaneoFetch<KaneoLabel[]>(kaneoConfig, 'GET', `/label/task/${kaneoId}`).catch(() => [])
      if (taskLabels.some((l) => l.name.toLowerCase() === 'archived')) archivedOk++
    }
    check(
      'Archived tasks labelled',
      archivedOk === archivedSample.length,
      `${archivedOk}/${archivedSample.length} archived tasks have "archived" label`,
    )
  } else {
    check('Archived tasks labelled', true, 'No archived issues to verify (skipped)')
  }

  return { passed: checks.every((c) => c.passed), checks }
}

// --- Main ---

async function main(): Promise<void> {
  console.log('\n=== Linear → Kaneo Migration E2E Test ===\n')

  const linearConfig: LinearConfig = { apiKey: linearKey!, teamId: linearTeamId! }

  try {
    // 1. Start Kaneo
    if (!skipUp) {
      await composeUp()
    }
    await waitForKaneo()

    // 2. Register user + create workspace
    const auth = await signUp()
    const kaneoConfig: KaneoConfig = { apiKey: auth.token, baseUrl: KANEO_BASE_URL }
    const workspace = await createWorkspace(kaneoConfig)

    // 3. Run migration
    console.log('\n--- Running migration ---\n')
    const { stats, linearIdToKaneoId, linearIssues, linearProjects } = await runMigration(
      linearConfig,
      kaneoConfig,
      workspace.id,
    )

    console.log('\n--- Migration Stats ---')
    console.log(`  Labels:   ${stats.labels}`)
    console.log(`  Projects: ${stats.projects}`)
    console.log(`  Columns:  ${stats.columns}`)
    console.log(`  Tasks:    ${stats.tasks}`)
    console.log(`  Comments: ${stats.comments}`)
    console.log(`  Relations: ${stats.relations}`)
    console.log(`  Archived: ${stats.archived}`)

    // 4. Verify
    console.log('\n--- Verification ---\n')
    const result = await verify(kaneoConfig, workspace.id, linearIssues, linearProjects, linearIdToKaneoId)

    // 5. Print results
    console.log('\n--- Results ---\n')
    for (const c of result.checks) {
      const icon = c.passed ? 'PASS' : 'FAIL'
      console.log(`  [${icon}] ${c.name}: ${c.detail}`)
    }

    console.log()
    if (result.passed) {
      console.log('All checks passed!')
    } else {
      console.log('Some checks failed.')
      process.exitCode = 1
    }
  } finally {
    if (!keepContainers && !skipUp) {
      await composeDown()
    }
  }
}

main().catch((error: unknown) => {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'E2E test failed')
  console.error('\nE2E test crashed:', error instanceof Error ? error.message : String(error))
  if (!keepContainers && !skipUp) {
    composeDown().catch(() => {})
  }
  process.exit(1)
})
