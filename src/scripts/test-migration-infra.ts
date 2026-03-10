import { $ } from 'bun'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { KaneoWorkspaceSchema, kaneoFetch } from '../kaneo/client.js'
import { logger } from '../logger.js'
import {
  AUTH_SECRET,
  COMPOSE_PROJECT,
  KANEO_BASE_URL,
  KANEO_PORT,
  POSTGRES_PASSWORD,
} from './test-migration-constants.js'

const log = logger.child({ scope: 'test-migration:infra' })

const COMPOSE_ENV = {
  KANEO_POSTGRES_PASSWORD: POSTGRES_PASSWORD,
  KANEO_AUTH_SECRET: AUTH_SECRET,
  KANEO_API_PORT: String(KANEO_PORT),
  KANEO_CLIENT_URL: 'http://localhost:5173',
  KANEO_API_URL: KANEO_BASE_URL,
}

export async function composeUp(): Promise<void> {
  log.info('Starting Kaneo services via docker compose')
  await $`docker compose -p ${COMPOSE_PROJECT} -f docker-compose.yml up -d kaneo-postgres kaneo-api --wait`.env(
    COMPOSE_ENV,
  )
  log.info('Docker compose services started')
}

export async function composeDown(): Promise<void> {
  log.info('Tearing down docker compose services')
  await $`docker compose -p ${COMPOSE_PROJECT} down -v --remove-orphans`.env(COMPOSE_ENV)
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

const AuthSessionSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
  }),
})

type AuthSession = z.infer<typeof AuthSessionSchema>

const TEST_EMAIL = 'migration-test@example.com'
const TEST_PASSWORD = 'test-password-123'
const TEST_NAME = 'Migration Test'
const WORKSPACE_NAME = 'Migration Test Workspace'

export async function signUp(): Promise<AuthSession> {
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

  const rawData: unknown = await res.json()
  const result = AuthSessionSchema.safeParse(rawData)
  if (!result.success) {
    throw new Error(`Kaneo sign-up returned invalid data: ${JSON.stringify(result.error.issues)}`)
  }

  log.info({ userId: result.data.user.id }, 'Test user registered')
  return result.data
}

export async function createWorkspace(config: KaneoConfig): Promise<z.infer<typeof KaneoWorkspaceSchema>> {
  log.info({ name: WORKSPACE_NAME }, 'Creating test workspace')
  const ws = await kaneoFetch(
    config,
    'POST',
    '/workspace',
    {
      name: WORKSPACE_NAME,
      slug: 'migration-test',
    },
    undefined,
    KaneoWorkspaceSchema,
  )
  log.info({ workspaceId: ws.id }, 'Workspace created')
  return ws
}
