import { mock, describe, expect, test, beforeEach } from 'bun:test'

// --- Mock for db (must come before importing config.ts) ---
const store = { data: new Map<string, string>() }

class MockDatabase {
  run(sql: string, params?: (string | number)[]): void {
    if (sql.includes('INSERT OR REPLACE INTO user_config') && params !== undefined) {
      store.data.set(`${params[0]}:${params[1]}`, String(params[2]))
    }
  }

  query(sql: string): {
    get: (...args: (string | number)[]) => { value: string } | null
    all: (...args: (string | number)[]) => Array<{ key: string; value: string }>
  } {
    if (sql.includes('SELECT value FROM user_config WHERE user_id') && sql.includes('AND key')) {
      return {
        get: (userId: string | number, key: string | number): { value: string } | null => {
          const value = store.data.get(`${userId}:${key}`)
          return value === undefined ? null : { value }
        },
        all: (): Array<{ key: string; value: string }> => [],
      }
    }
    if (sql.includes('SELECT key, value FROM user_config WHERE user_id')) {
      return {
        get: (): null => null,
        all: (userId: string | number): Array<{ key: string; value: string }> => {
          const prefix = `${userId}:`
          return Array.from(store.data.entries())
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => ({ key: k.slice(prefix.length), value: v }))
        },
      }
    }
    return { get: (): null => null, all: (): Array<{ key: string; value: string }> => [] }
  }
}

const mockDb = new MockDatabase()

void mock.module('../src/db/index.js', () => ({
  getDb: (): MockDatabase => mockDb,
  DB_PATH: ':memory:',
  initDb: (): void => {},
}))

import { CONFIG_KEYS, getAllConfig, getConfig, isConfigKey, maskValue, setConfig } from '../src/config.js'
import type { ConfigKey } from '../src/config.js'

const USER_A = 111
const USER_B = 222

describe('setConfig', () => {
  beforeEach(() => {
    store.data.clear()
  })

  test('stores value for user and key', () => {
    setConfig(USER_A, 'huly_email', 'test@example.com')
    expect(getConfig(USER_A, 'huly_email')).toBe('test@example.com')
  })

  test('updates existing value', () => {
    setConfig(USER_A, 'huly_email', 'old@example.com')
    setConfig(USER_A, 'huly_email', 'new@example.com')
    expect(getConfig(USER_A, 'huly_email')).toBe('new@example.com')
  })

  test('isolates config between users', () => {
    setConfig(USER_A, 'huly_email', 'user-a@example.com')
    setConfig(USER_B, 'huly_email', 'user-b@example.com')
    expect(getConfig(USER_A, 'huly_email')).toBe('user-a@example.com')
    expect(getConfig(USER_B, 'huly_email')).toBe('user-b@example.com')
  })

  test('handles all config keys', () => {
    const allKeys: ConfigKey[] = [
      'huly_email',
      'huly_password',
      'openai_key',
      'openai_base_url',
      'openai_model',
      'memory_model',
    ]
    allKeys.forEach((key) => {
      setConfig(USER_A, key, `value-for-${key}`)
      expect(getConfig(USER_A, key)).toBe(`value-for-${key}`)
    })
  })
})

describe('getConfig', () => {
  beforeEach(() => {
    store.data.clear()
  })

  test('returns stored value', () => {
    setConfig(USER_A, 'huly_password', 'secret-password')
    expect(getConfig(USER_A, 'huly_password')).toBe('secret-password')
  })

  test('returns null for unset key', () => {
    expect(getConfig(USER_A, 'openai_model')).toBeNull()
  })
})

describe('isConfigKey', () => {
  test('returns true for valid keys', () => {
    const validKeys: ConfigKey[] = [
      'huly_email',
      'huly_password',
      'openai_key',
      'openai_base_url',
      'openai_model',
      'memory_model',
    ]
    validKeys.forEach((key) => {
      expect(isConfigKey(key)).toBe(true)
    })
  })

  test('returns false for invalid keys', () => {
    const invalidKeys = ['invalid', 'linear', 'openai', 'token', '']
    invalidKeys.forEach((key) => {
      expect(isConfigKey(key)).toBe(false)
    })
  })
})

describe('getAllConfig', () => {
  beforeEach(() => {
    store.data.clear()
  })

  test('returns all set configs for user', () => {
    setConfig(USER_A, 'huly_email', 'user@example.com')
    setConfig(USER_A, 'openai_model', 'gpt-4')
    const allConfig = getAllConfig(USER_A)
    expect(allConfig.huly_email).toBe('user@example.com')
    expect(allConfig.openai_model).toBe('gpt-4')
  })

  test('does not leak config from other users', () => {
    setConfig(USER_A, 'huly_email', 'user-a@example.com')
    setConfig(USER_B, 'huly_email', 'user-b@example.com')
    const configA = getAllConfig(USER_A)
    expect(configA.huly_email).toBe('user-a@example.com')
  })
})

describe('maskValue', () => {
  test('masks sensitive keys', () => {
    expect(maskValue('huly_password', 'secret-password-1234')).toBe('****1234')
    expect(maskValue('openai_key', 'sk-abc123')).toBe('****c123')
  })

  test('returns unmasked value for non-sensitive keys', () => {
    expect(maskValue('huly_email', 'user@example.com')).toBe('user@example.com')
    expect(maskValue('openai_model', 'gpt-4')).toBe('gpt-4')
    expect(maskValue('openai_base_url', 'https://api.openai.com')).toBe('https://api.openai.com')
  })

  test('handles short values for sensitive keys', () => {
    expect(maskValue('huly_password', 'ab')).toBe('****ab')
    expect(maskValue('huly_password', '')).toBe('****')
  })
})

describe('CONFIG_KEYS', () => {
  test('contains all expected keys', () => {
    expect(CONFIG_KEYS).toContain('huly_email')
    expect(CONFIG_KEYS).toContain('huly_password')
    expect(CONFIG_KEYS).toContain('openai_key')
    expect(CONFIG_KEYS).toContain('openai_base_url')
    expect(CONFIG_KEYS).toContain('openai_model')
    expect(CONFIG_KEYS).toContain('memory_model')
  })

  test('has correct length', () => {
    expect(CONFIG_KEYS).toHaveLength(6)
  })
})
