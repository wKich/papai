import { $ } from 'bun'
import { z } from 'zod'

import { logger } from '../logger.js'
import {
  AUTH_SECRET,
  COMPOSE_PROJECT,
  KANEO_BASE_URL,
  KANEO_CLIENT_URL,
  KANEO_PORT,
  POSTGRES_PASSWORD,
} from './test-migration-constants.js'

const log = logger.child({ scope: 'test-migration:infra' })

const COMPOSE_ENV = {
  ...process.env,
  KANEO_POSTGRES_PASSWORD: POSTGRES_PASSWORD,
  KANEO_AUTH_SECRET: AUTH_SECRET,
  KANEO_API_PORT: String(KANEO_PORT),
  KANEO_CLIENT_URL: 'http://localhost:5173',
  KANEO_API_URL: KANEO_BASE_URL,
}

export async function composeUp(): Promise<void> {
  log.info('Starting Kaneo services via docker compose')
  await $`docker compose -p ${COMPOSE_PROJECT} -f docker-compose.yml -f docker-compose.test.yml up -d kaneo-postgres kaneo-api --wait`.env(
    COMPOSE_ENV,
  )
  // Run the one-shot DB fix service (blocks until it exits).
  // Not included in --wait above because compose exits 1 when any listed
  // service exits, even successfully.
  await $`docker compose -p ${COMPOSE_PROJECT} -f docker-compose.yml -f docker-compose.test.yml up kaneo-db-fix`.env(
    COMPOSE_ENV,
  )
  log.info('Docker compose services started')
}

export async function composeDown(): Promise<void> {
  log.info('Tearing down docker compose services')
  await $`docker compose -p ${COMPOSE_PROJECT} -f docker-compose.yml -f docker-compose.test.yml down -v --remove-orphans`.env(
    COMPOSE_ENV,
  )
  log.info('Docker compose services torn down')
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${KANEO_BASE_URL}/api/health`)
    return res.ok
  } catch {
    return false
  }
}

async function retryWithDelay(attempt: number): Promise<boolean> {
  const isReady = await checkHealth()
  if (isReady) {
    log.info({ attempt }, 'Kaneo API is ready')
    return true
  }
  log.debug({ attempt }, 'Kaneo not ready, retrying')
  await Bun.sleep(2000)
  return false
}

export async function waitForKaneo(maxAttempts = 30): Promise<void> {
  log.info({ maxAttempts }, 'Waiting for Kaneo API to be ready')

  const attempt = async (currentAttempt: number): Promise<void> => {
    if (currentAttempt > maxAttempts) {
      throw new Error('Kaneo API did not become ready in time')
    }

    const isReady = await retryWithDelay(currentAttempt)
    if (isReady) {
      return
    }

    return attempt(currentAttempt + 1)
  }

  await attempt(1)
}

// --- Auth + workspace ---

const SignUpBodySchema = z.object({
  user: z.object({ id: z.string() }),
})

const OrgSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

export interface AuthSession {
  sessionCookie: string
  userId: string
}

const TEST_EMAIL = 'migration-test@example.com'
const TEST_PASSWORD = 'test-password-123'
const TEST_NAME = 'Migration Test'

function makeWorkspaceSlug(): string {
  return `migration-test-${Date.now()}`
}

export async function signUp(): Promise<AuthSession> {
  log.info({ email: TEST_EMAIL }, 'Registering test user on Kaneo')

  const res = await fetch(`${KANEO_BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
  })

  if (!res.ok) {
    const body = await res.text()
    // If user already exists from a previous run, sign in instead
    if (res.status === 422 && body.includes('USER_ALREADY_EXISTS')) {
      log.info({ email: TEST_EMAIL }, 'User already exists, signing in')
      return signIn()
    }
    throw new Error(`Kaneo sign-up failed (${res.status}): ${body}`)
  }

  const setCookies = res.headers.getSetCookie()
  const sessionHeader = setCookies.find((h) => h.startsWith('better-auth.session_token='))
  if (sessionHeader === undefined) {
    throw new Error('Kaneo sign-up response missing session cookie')
  }
  const sessionCookie = sessionHeader.split(';')[0]!

  const rawData: unknown = await res.json()
  const parsed = SignUpBodySchema.safeParse(rawData)
  if (!parsed.success) {
    throw new Error(`Kaneo sign-up returned invalid data: ${JSON.stringify(parsed.error.issues)}`)
  }

  log.info({ userId: parsed.data.user.id }, 'Test user registered')
  return { sessionCookie, userId: parsed.data.user.id }
}

async function signIn(): Promise<AuthSession> {
  const res = await fetch(`${KANEO_BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Kaneo sign-in failed (${res.status}): ${body}`)
  }

  const setCookies = res.headers.getSetCookie()
  const sessionHeader = setCookies.find((h) => h.startsWith('better-auth.session_token='))
  if (sessionHeader === undefined) {
    throw new Error('Kaneo sign-in response missing session cookie')
  }
  const sessionCookie = sessionHeader.split(';')[0]!

  const rawData: unknown = await res.json()
  const parsed = SignUpBodySchema.safeParse(rawData)
  if (!parsed.success) {
    throw new Error(`Kaneo sign-in returned invalid data: ${JSON.stringify(parsed.error.issues)}`)
  }

  log.info({ userId: parsed.data.user.id }, 'Test user signed in')
  return { sessionCookie, userId: parsed.data.user.id }
}

export async function createWorkspace(sessionCookie: string): Promise<z.infer<typeof OrgSchema>> {
  const slug = makeWorkspaceSlug()
  log.info({ name: slug }, 'Creating test workspace')

  const res = await fetch(`${KANEO_BASE_URL}/api/auth/organization/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Origin: KANEO_CLIENT_URL,
    },
    body: JSON.stringify({ name: slug, slug }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Kaneo workspace creation failed (${res.status}): ${body}`)
  }

  const rawData: unknown = await res.json()
  const result = OrgSchema.safeParse(rawData)
  if (!result.success) {
    throw new Error(`Kaneo workspace creation returned invalid data: ${JSON.stringify(result.error.issues)}`)
  }

  log.info({ workspaceId: result.data.id }, 'Workspace created')
  return result.data
}
