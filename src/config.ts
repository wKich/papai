import { getCachedConfig, setCachedConfig } from './cache.js'
import { logger } from './logger.js'
import { CONFIG_KEYS, type ConfigKey } from './types/config.js'

const log = logger.child({ scope: 'config' })

const SENSITIVE_KEYS: ReadonlySet<ConfigKey> = new Set(['kaneo_apikey', 'youtrack_token', 'llm_apikey'])

export function setConfig(userId: string, key: ConfigKey, value: string): void {
  log.debug({ userId, key }, 'setConfig called')
  setCachedConfig(userId, key, value)
  log.info({ userId, key }, 'Config key set (DB sync in background)')
}

export function getConfig(userId: string, key: ConfigKey): string | null {
  log.debug({ userId, key }, 'getConfig called')
  return getCachedConfig(userId, key)
}

// All valid config keys regardless of current provider (for type checking)
const ALL_CONFIG_KEYS: readonly string[] = [
  'kaneo_apikey',
  'youtrack_token',
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
  'embedding_model',
  'timezone',
]

export function isConfigKey(key: string): key is ConfigKey {
  return ALL_CONFIG_KEYS.includes(key)
}

export function getAllConfig(userId: string): Partial<Record<ConfigKey, string>> {
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

const LLM_COPY_KEYS: readonly ConfigKey[] = [
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
  'embedding_model',
]

export function copyAdminLlmConfig(targetUserId: string, adminUserId: string): void {
  log.debug({ targetUserId }, 'copyAdminLlmConfig called')
  for (const key of LLM_COPY_KEYS) {
    const existingValue = getCachedConfig(targetUserId, key)
    if (existingValue !== null) continue
    const adminValue = getCachedConfig(adminUserId, key)
    if (adminValue === null) continue
    setCachedConfig(targetUserId, key, adminValue)
  }
  log.info({ targetUserId }, 'LLM config copied from admin')
}

export function maskValue(key: ConfigKey, value: string): string {
  if (SENSITIVE_KEYS.has(key)) {
    const last4 = value.slice(-4)
    return `****${last4}`
  }
  return value
}
