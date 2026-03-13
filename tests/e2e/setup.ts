import { afterAll, beforeAll } from 'bun:test'

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

  log.info({ baseUrl }, 'Setting up E2E environment')

  try {
    const result = await provisionKaneoUser(baseUrl, baseUrl, 999999999, 'e2e-test')

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

beforeAll(async () => {
  await setupE2EEnvironment()
})

afterAll(async () => {
  await teardownE2EEnvironment()
})
