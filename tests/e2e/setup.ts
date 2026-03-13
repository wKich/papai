import { provisionKaneoUser } from '../../src/kaneo/provision.js'
import { logger } from '../../src/logger.js'
import { isDockerStarted, startKaneoServer, stopKaneoServer } from './docker-lifecycle.js'

const log = logger.child({ scope: 'e2e:setup' })

export type E2EConfig = {
  baseUrl: string
  apiKey: string
  workspaceId: string
}

let e2eConfig: E2EConfig | undefined
let setupComplete = false

export function getE2EConfig(): E2EConfig {
  if (e2eConfig === undefined) {
    throw new Error('E2E environment not initialized. Call setupE2EEnvironment() first.')
  }
  return e2eConfig
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

async function waitForServer(baseUrl: string, maxAttempts = 30): Promise<void> {
  const healthUrl = `${baseUrl}/api/health`
  log.info({ healthUrl }, 'Waiting for Kaneo server to be healthy')

  let attempt = 1

  while (attempt <= maxAttempts) {
    try {
      // eslint-disable-next-line no-await-in-loop -- Intentional sequential polling
      const response = await fetch(healthUrl, { method: 'GET' })
      if (response.ok) {
        log.info({ attempts: attempt }, 'Kaneo server is healthy')
        return
      }
    } catch {
      // Server not ready yet
    }

    if (attempt < maxAttempts) {
      log.debug({ attempt, maxAttempts }, 'Server not ready, waiting...')
      // eslint-disable-next-line no-await-in-loop -- Intentional delay between polling attempts
      await delay(1000)
    }

    attempt++
  }

  throw new Error(`Kaneo server failed to become healthy after ${maxAttempts} attempts`)
}

export async function setupE2EEnvironment(): Promise<void> {
  if (setupComplete) {
    log.debug('E2E environment already set up')
    return
  }

  const baseUrl = process.env['E2E_KANEO_URL'] ?? process.env['KANEO_INTERNAL_URL'] ?? 'http://localhost:11337'
  // Use KANEO_CLIENT_URL as the public/trusted origin for auth requests
  const publicUrl = process.env['KANEO_CLIENT_URL'] ?? baseUrl

  log.info({ baseUrl, publicUrl }, 'Setting up E2E environment')

  try {
    await startKaneoServer()
    // Wait for server to be healthy before provisioning
    await waitForServer(baseUrl)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to start Kaneo server')
    throw error
  }

  try {
    // Use unique identifiers to avoid conflicts from previous test runs
    const uniqueSuffix = Date.now()
    const uniqueUsername = `e2e-test-${uniqueSuffix}`
    // Ensure unique telegram ID to avoid workspace slug conflicts
    const uniqueTelegramId = 999999999 + (uniqueSuffix % 1000000)
    const result = await provisionKaneoUser(baseUrl, publicUrl, uniqueTelegramId, uniqueUsername)

    e2eConfig = {
      baseUrl,
      apiKey: result.kaneoKey,
      workspaceId: result.workspaceId,
    }

    setupComplete = true
    log.info({ workspaceId: result.workspaceId }, 'E2E environment setup complete')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ error: message, baseUrl }, 'Failed to setup E2E environment')
    // Don't stop Docker here - let teardown handle it
    throw error
  }
}

export async function teardownE2EEnvironment(): Promise<void> {
  log.info('Tearing down E2E environment')

  e2eConfig = undefined
  setupComplete = false

  await stopKaneoServer()
}

// Global teardown hook for when tests exit
process.on('exit', () => {
  if (isDockerStarted()) {
    log.warn('Process exiting with Docker still running - this may leave containers behind')
  }
})

process.on('SIGINT', () => {
  log.info('Received SIGINT, cleaning up...')
  teardownE2EEnvironment()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
})

process.on('SIGTERM', () => {
  log.info('Received SIGTERM, cleaning up...')
  teardownE2EEnvironment()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
})
