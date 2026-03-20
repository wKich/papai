import { Database } from 'bun:sqlite'
import { describe, expect, test, beforeEach } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import { getAllConfig, getConfig, isConfigKey, maskValue, setConfig } from '../src/config.js'
import { _resetDrizzleDb, _setDrizzleDb } from '../src/db/drizzle.js'
import { runMigrations } from '../src/db/migrate.js'
import { migration001Initial } from '../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../src/db/migrations/007_platform_user_id.js'
import * as schema from '../src/db/schema.js'
import { CONFIG_KEYS, type ConfigKey } from '../src/types/config.js'
import { clearUserCache } from './utils/test-cache.js'

const USER_A = '111'
const USER_B = '222'

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
] as const

describe('setConfig', () => {
  beforeEach(() => {
    _resetDrizzleDb()
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, MIGRATIONS)
    const testDb = drizzle(sqlite, { schema })
    _setDrizzleDb(testDb)
    clearUserCache(USER_A)
    clearUserCache(USER_B)
  })

  test('stores value for user and key', () => {
    setConfig(USER_A, 'kaneo_apikey', 'test-api-key')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('test-api-key')
  })

  test('updates existing value', () => {
    setConfig(USER_A, 'kaneo_apikey', 'old-key')
    setConfig(USER_A, 'kaneo_apikey', 'new-key')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('new-key')
  })

  test('isolates config between users', () => {
    setConfig(USER_A, 'kaneo_apikey', 'key-a')
    setConfig(USER_B, 'kaneo_apikey', 'key-b')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('key-a')
    expect(getConfig(USER_B, 'kaneo_apikey')).toBe('key-b')
  })

  test('handles all config keys', () => {
    const allKeys: ConfigKey[] = ['kaneo_apikey', 'llm_apikey', 'llm_baseurl', 'main_model', 'small_model']
    allKeys.forEach((key) => {
      setConfig(USER_A, key, `value-for-${key}`)
      expect(getConfig(USER_A, key)).toBe(`value-for-${key}`)
    })
  })
})

describe('getConfig', () => {
  beforeEach(() => {
    _resetDrizzleDb()
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, MIGRATIONS)
    const testDb = drizzle(sqlite, { schema })
    _setDrizzleDb(testDb)
    clearUserCache(USER_A)
    clearUserCache(USER_B)
  })

  test('returns stored value', () => {
    setConfig(USER_A, 'kaneo_apikey', 'key-abc')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('key-abc')
  })

  test('returns null for unset key', () => {
    expect(getConfig(USER_A, 'main_model')).toBeNull()
  })
})

describe('isConfigKey', () => {
  test('returns true for valid keys', () => {
    const validKeys: ConfigKey[] = ['kaneo_apikey', 'llm_apikey', 'llm_baseurl', 'main_model', 'small_model']
    validKeys.forEach((key) => {
      expect(isConfigKey(key)).toBe(true)
    })
  })

  test('returns false for invalid keys', () => {
    const invalidKeys = ['invalid', 'linear', 'openai', 'token', '', 'linear_key']
    invalidKeys.forEach((key) => {
      expect(isConfigKey(key)).toBe(false)
    })
  })
})

describe('getAllConfig', () => {
  beforeEach(() => {
    _resetDrizzleDb()
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, MIGRATIONS)
    const testDb = drizzle(sqlite, { schema })
    _setDrizzleDb(testDb)
    clearUserCache(USER_A)
    clearUserCache(USER_B)
  })

  test('returns all set configs for user', () => {
    setConfig(USER_A, 'kaneo_apikey', 'key-1')
    setConfig(USER_A, 'main_model', 'gpt-4')
    const allConfig = getAllConfig(USER_A)
    expect(allConfig.kaneo_apikey).toBe('key-1')
    expect(allConfig.main_model).toBe('gpt-4')
  })

  test('does not leak config from other users', () => {
    setConfig(USER_A, 'kaneo_apikey', 'key-a')
    setConfig(USER_B, 'kaneo_apikey', 'key-b')
    const configA = getAllConfig(USER_A)
    expect(configA.kaneo_apikey).toBe('key-a')
  })
})

describe('maskValue', () => {
  test('masks sensitive keys', () => {
    expect(maskValue('kaneo_apikey', 'secret-key-1234')).toBe('****1234')
    expect(maskValue('llm_apikey', 'sk-abc123')).toBe('****c123')
  })

  test('returns unmasked value for non-sensitive keys', () => {
    expect(maskValue('main_model', 'gpt-4')).toBe('gpt-4')
    expect(maskValue('llm_baseurl', 'https://api.openai.com')).toBe('https://api.openai.com')
  })

  test('handles short values for sensitive keys', () => {
    expect(maskValue('kaneo_apikey', 'ab')).toBe('****ab')
    expect(maskValue('kaneo_apikey', '')).toBe('****')
  })
})

describe('CONFIG_KEYS', () => {
  test('contains all expected keys', () => {
    expect(CONFIG_KEYS).toContain('provider')
    expect(CONFIG_KEYS).toContain('kaneo_apikey')
    expect(CONFIG_KEYS).toContain('youtrack_url')
    expect(CONFIG_KEYS).toContain('youtrack_token')
    expect(CONFIG_KEYS).toContain('llm_apikey')
    expect(CONFIG_KEYS).toContain('llm_baseurl')
    expect(CONFIG_KEYS).toContain('main_model')
    expect(CONFIG_KEYS).toContain('small_model')
  })

  test('has correct length', () => {
    expect(CONFIG_KEYS).toHaveLength(8)
  })
})
