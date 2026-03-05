import { mock, describe, expect, test, beforeEach } from 'bun:test'

// --- Mock for db (must come before importing config.ts) ---
const store = { data: new Map<string, string>() }

class MockDatabase {
  run(sql: string, params?: string[]): void {
    if (sql.includes('INSERT OR REPLACE') && params !== undefined) {
      store.data.set(params[0]!, params[1]!)
    }
  }

  query(sql: string): {
    get: (key: string) => { value: string } | null
    all: () => Array<{ key: string; value: string }>
  } {
    if (sql.includes('SELECT value FROM config WHERE key')) {
      return {
        get: (key: string): { value: string } | null => {
          const value = store.data.get(key)
          if (value === undefined) {
            return null
          }
          return { value }
        },
        all: (): Array<{ key: string; value: string }> => [],
      }
    }
    if (sql.includes('SELECT key, value FROM config')) {
      return {
        get: (): null => null,
        all: (): Array<{ key: string; value: string }> =>
          Array.from(store.data.entries()).map(([key, value]) => ({ key, value })),
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

describe('setConfig', () => {
  beforeEach(() => {
    store.data.clear()
  })

  test('stores value for key', () => {
    setConfig('linear_key', 'test-api-key')
    expect(getConfig('linear_key')).toBe('test-api-key')
  })

  test('updates existing value', () => {
    setConfig('linear_key', 'old-key')
    setConfig('linear_key', 'new-key')
    expect(getConfig('linear_key')).toBe('new-key')
  })

  test('handles all config keys', () => {
    const allKeys: ConfigKey[] = ['linear_key', 'linear_team_id', 'openai_key', 'openai_base_url', 'openai_model']
    allKeys.forEach((key) => {
      setConfig(key, `value-for-${key}`)
      expect(getConfig(key)).toBe(`value-for-${key}`)
    })
  })
})

describe('getConfig', () => {
  beforeEach(() => {
    store.data.clear()
  })

  test('returns stored value', () => {
    setConfig('linear_team_id', 'team-abc')
    expect(getConfig('linear_team_id')).toBe('team-abc')
  })
})

describe('isConfigKey', () => {
  test('returns true for valid keys', () => {
    const validKeys: ConfigKey[] = ['linear_key', 'linear_team_id', 'openai_key', 'openai_base_url', 'openai_model']
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

  test('returns all set configs', () => {
    setConfig('linear_key', 'key-1')
    setConfig('openai_model', 'gpt-4')
    const allConfig = getAllConfig()
    expect(allConfig.linear_key).toBe('key-1')
    expect(allConfig.openai_model).toBe('gpt-4')
  })
})

describe('maskValue', () => {
  test('masks sensitive keys', () => {
    expect(maskValue('linear_key', 'secret-key-1234')).toBe('****1234')
    expect(maskValue('openai_key', 'sk-abc123')).toBe('****c123')
  })

  test('returns unmasked value for non-sensitive keys', () => {
    expect(maskValue('linear_team_id', 'team-123')).toBe('team-123')
    expect(maskValue('openai_model', 'gpt-4')).toBe('gpt-4')
    expect(maskValue('openai_base_url', 'https://api.openai.com')).toBe('https://api.openai.com')
  })

  test('handles short values for sensitive keys', () => {
    expect(maskValue('linear_key', 'ab')).toBe('****ab')
    expect(maskValue('linear_key', '')).toBe('****')
  })
})

describe('CONFIG_KEYS', () => {
  test('contains all expected keys', () => {
    expect(CONFIG_KEYS).toContain('linear_key')
    expect(CONFIG_KEYS).toContain('linear_team_id')
    expect(CONFIG_KEYS).toContain('openai_key')
    expect(CONFIG_KEYS).toContain('openai_base_url')
    expect(CONFIG_KEYS).toContain('openai_model')
    expect(CONFIG_KEYS).toContain('memory_model')
  })

  test('has correct length', () => {
    expect(CONFIG_KEYS).toHaveLength(6)
  })
})
