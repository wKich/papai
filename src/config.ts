import { getCachedConfig, setCachedConfig } from './cache.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'config' })

export type ConfigKey = 'provider' | 'kaneo_apikey' | 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model'

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'provider',
  'kaneo_apikey',
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
]

const SENSITIVE_KEYS: ReadonlySet<ConfigKey> = new Set(['kaneo_apikey', 'llm_apikey'])

export function setConfig(userId: number, key: ConfigKey, value: string): void {
  log.debug({ userId, key }, 'setConfig called')
  setCachedConfig(userId, key, value)
  log.info({ userId, key }, 'Config key set (DB sync in background)')
}

export function getConfig(userId: number, key: ConfigKey): string | null {
  log.debug({ userId, key }, 'getConfig called')
  return getCachedConfig(userId, key)
}

export function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key)
}

export function getAllConfig(userId: number): Partial<Record<ConfigKey, string>> {
  log.debug({ userId }, 'getAllConfig called')
  const result: Partial<Record<ConfigKey, string>> = {}
  for (const key of CONFIG_KEYS) {
    const value = getCachedConfig(userId, key)
    if (value !== null) {
      result[key] = value
    }
  }
  return result
}

export function maskValue(key: ConfigKey, value: string): string {
  if (SENSITIVE_KEYS.has(key)) {
    const last4 = value.slice(-4)
    return `****${last4}`
  }
  return value
}
