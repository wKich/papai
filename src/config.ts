import { getDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'config' })

export type ConfigKey = 'kaneo_apikey' | 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model'

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'kaneo_apikey',
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
]

const SENSITIVE_KEYS: ReadonlySet<ConfigKey> = new Set(['kaneo_apikey', 'llm_apikey'])

export function setConfig(userId: number, key: ConfigKey, value: string): void {
  log.debug({ userId, key }, 'setConfig called')
  getDb().run('INSERT OR REPLACE INTO user_config (user_id, key, value) VALUES (?, ?, ?)', [userId, key, value])
  log.info({ userId, key }, 'Config key set')
}

export function getConfig(userId: number, key: ConfigKey): string | null {
  log.debug({ userId, key }, 'getConfig called')
  const row = getDb()
    .query<{ value: string }, [number, string]>('SELECT value FROM user_config WHERE user_id = ? AND key = ?')
    .get(userId, key)
  return row?.value ?? null
}

export function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key)
}

export function getAllConfig(userId: number): Partial<Record<ConfigKey, string>> {
  log.debug({ userId }, 'getAllConfig called')
  const rows = getDb()
    .query<{ key: string; value: string }, [number]>('SELECT key, value FROM user_config WHERE user_id = ?')
    .all(userId)
  return rows.reduce<Partial<Record<ConfigKey, string>>>(
    (acc, row) => (isConfigKey(row.key) ? { ...acc, [row.key]: row.value } : acc),
    {},
  )
}

export function maskValue(key: ConfigKey, value: string): string {
  if (SENSITIVE_KEYS.has(key)) {
    const last4 = value.slice(-4)
    return `****${last4}`
  }
  return value
}
