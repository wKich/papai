import type { KaneoConfig } from '../../src/kaneo/client.js'
import { getE2EConfig } from './global-setup.js'

/**
 * Generate a random suffix for unique entity names
 */
export function generateUniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Get the shared Kaneo config for all tests
 */
export async function getSharedKaneoConfig(): Promise<KaneoConfig> {
  const config = await getE2EConfig()
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  }
}

/**
 * Get the shared workspace ID for all tests
 */
export async function getSharedWorkspaceId(): Promise<string> {
  const config = await getE2EConfig()
  return config.workspaceId
}
