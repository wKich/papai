import { logger } from '../logger.js'
import { KaneoProvider, type KaneoConfig } from './kaneo/index.js'
import type { TaskProvider } from './types.js'

const log = logger.child({ scope: 'provider:registry' })

export type ProviderName = 'kaneo'

const PROVIDER_NAMES = new Set<string>(['kaneo'])

export type ProviderFactory = (config: Record<string, string>) => TaskProvider

const providers = new Map<string, ProviderFactory>()

/** Register the built-in Kaneo provider. */
providers.set('kaneo', (config) => {
  const apiKey = config['apiKey'] ?? ''
  const baseUrl = config['baseUrl'] ?? ''
  const sessionCookie = config['sessionCookie']
  const workspaceId = config['workspaceId'] ?? ''

  const kaneoConfig: KaneoConfig =
    sessionCookie === undefined ? { apiKey, baseUrl } : { apiKey: '', baseUrl, sessionCookie }

  return new KaneoProvider(kaneoConfig, workspaceId)
})

/** Check if a string is a valid provider name. */
export function isProviderName(name: string): name is ProviderName {
  return PROVIDER_NAMES.has(name)
}

/**
 * Create a TaskProvider instance by name.
 *
 * @param name - The provider name (e.g. "kaneo")
 * @param config - Provider-specific config key-value pairs
 * @returns A TaskProvider instance
 * @throws Error if the provider name is not registered
 */
export function createProvider(name: string, config: Record<string, string>): TaskProvider {
  const factory = providers.get(name)
  if (factory === undefined) {
    log.error({ name }, 'Unknown provider requested')
    throw new Error(`Unknown provider: ${name}. Available providers: ${[...providers.keys()].join(', ')}`)
  }
  log.debug({ name }, 'Creating provider instance')
  return factory(config)
}

/** List all registered provider names. */
export function listProviders(): string[] {
  return [...PROVIDER_NAMES]
}
