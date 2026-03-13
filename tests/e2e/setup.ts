import { provisionKaneoUser } from '../../src/kaneo/provision.js'
import { logger } from '../../src/logger.js'

const log = logger.child({ scope: 'e2e:setup' })

export type E2EConfig = {
  baseUrl: string
  apiKey: string
  workspaceId: string
}

let e2eConfig: E2EConfig | undefined

export function getE2EConfig(): E2EConfig {
  if (e2eConfig === undefined) {
    throw new Error('E2E environment not initialized. Call setupE2EEnvironment() first.')
  }
  return e2eConfig
}

export async function setupE2EEnvironment(): Promise<void> {
  const baseUrl = process.env['E2E_KANEO_URL'] ?? process.env['KANEO_INTERNAL_URL'] ?? 'http://localhost:11337'
  // Use KANEO_CLIENT_URL as the public/trusted origin for auth requests
  const publicUrl = process.env['KANEO_CLIENT_URL'] ?? baseUrl

  log.info({ baseUrl, publicUrl }, 'Setting up E2E environment')

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

    log.info({ workspaceId: result.workspaceId }, 'E2E environment setup complete')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ error: message, baseUrl }, 'Failed to setup E2E environment')
    throw error
  }
}

export async function teardownE2EEnvironment(): Promise<void> {
  log.info('Tearing down E2E environment')
  e2eConfig = undefined
}
