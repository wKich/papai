import { Database } from 'bun:sqlite'

import { logger } from './logger.js'

export type ConfigKey = 'linear_key' | 'linear_team_id' | 'openai_key' | 'openai_base_url' | 'openai_model'

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'linear_key',
  'linear_team_id',
  'openai_key',
  'openai_base_url',
  'openai_model',
]

const SENSITIVE_KEYS: ReadonlySet<ConfigKey> = new Set(['linear_key', 'openai_key'])

const db = new Database('papai.db')
db.run('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

export function setConfig(key: ConfigKey, value: string): void {
  logger.debug({ key }, 'setConfig called')
  db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [key, value])
  logger.info({ key }, 'Config key set')
}

export function getConfig(key: ConfigKey): string | null {
  logger.debug({ key }, 'getConfig called')
  const row = db.query<{ value: string }, [string]>('SELECT value FROM config WHERE key = ?').get(key)
  return row?.value ?? null
}

export function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key)
}

export function getAllConfig(): Partial<Record<ConfigKey, string>> {
  logger.debug('getAllConfig called')
  const rows = db.query<{ key: string; value: string }, []>('SELECT key, value FROM config').all()
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
