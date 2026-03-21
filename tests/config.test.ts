import { mock, describe, expect, test, beforeEach } from 'bun:test'

import { mockLogger, setupTestDb } from './utils/test-helpers.js'

// Setup logger mock at top of file
mockLogger()

// Mock getDrizzleDb to return our test database
let testDb: Awaited<ReturnType<typeof setupTestDb>>

void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): typeof testDb => testDb,
  closeDrizzleDb: (): void => {},
  _resetDrizzleDb: (): void => {},
  _setDrizzleDb: (): void => {},
}))

import { getAllConfig, getConfig, isConfigKey, maskValue, setConfig } from '../src/config.js'
import { CONFIG_KEYS, type ConfigKey } from '../src/types/config.js'
import { clearUserCache } from './utils/test-cache.js'

const USER_A = '111'
const USER_B = '222'

describe('setConfig', () => {
  beforeEach(async () => {
    testDb = await setupTestDb()
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
    // Test LLM keys which are always available
    const llmKeys: ConfigKey[] = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model']
    llmKeys.forEach((key) => {
      setConfig(USER_A, key, `value-for-${key}`)
      expect(getConfig(USER_A, key)).toBe(`value-for-${key}`)
    })
    // Test provider-specific key (kaneo when TASK_PROVIDER not set or kaneo)
    setConfig(USER_A, 'kaneo_apikey', 'value-for-kaneo_apikey')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('value-for-kaneo_apikey')
  })
})

describe('getConfig', () => {
  beforeEach(async () => {
    testDb = await setupTestDb()
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
    // These are always valid
    const validKeys: ConfigKey[] = ['kaneo_apikey', 'llm_apikey', 'llm_baseurl', 'main_model', 'small_model']
    validKeys.forEach((key) => {
      expect(isConfigKey(key)).toBe(true)
    })
  })

  test('returns false for invalid keys', () => {
    // These are never valid config keys
    const invalidKeys = ['invalid', 'linear', 'openai', 'token', '', 'linear_key', 'provider', 'youtrack_url']
    invalidKeys.forEach((key) => {
      expect(isConfigKey(key)).toBe(false)
    })
  })
})

describe('getAllConfig', () => {
  beforeEach(async () => {
    testDb = await setupTestDb()
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
    // These are always available
    expect(CONFIG_KEYS).toContain('llm_apikey')
    expect(CONFIG_KEYS).toContain('llm_baseurl')
    expect(CONFIG_KEYS).toContain('main_model')
    expect(CONFIG_KEYS).toContain('small_model')
    // Provider-specific keys (depends on TASK_PROVIDER env var)
    expect(CONFIG_KEYS).toContain('kaneo_apikey')
  })

  test('has correct length', () => {
    // LLM keys (4) + provider-specific key (1) + preference keys (1) + proactive keys (5) = 11
    expect(CONFIG_KEYS).toHaveLength(11)
  })
})
