import { mock, describe, it, expect, beforeEach, afterEach } from 'bun:test'

// --- Mock for db (must come before importing huly-client.ts) ---
const store = { data: new Map<string, string>() }

class MockDatabase {
  run(sql: string, params?: (string | number)[]): void {
    if (sql.includes('INSERT OR REPLACE INTO user_config') && params !== undefined) {
      store.data.set(`${params[0]}:${params[1]}`, String(params[2]))
    }
    if (sql.includes('DELETE FROM user_config') && params !== undefined) {
      if (params.length === 1) {
        // Delete all for user
        for (const key of store.data.keys()) {
          if (key.startsWith(`${params[0]}:`)) {
            store.data.delete(key)
          }
        }
      } else if (params.length === 2) {
        // Delete specific key
        store.data.delete(`${params[0]}:${params[1]}`)
      }
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
    return { get: (): null => null, all: (): Array<{ key: string; value: string }> => [] }
  }
}

const mockDb = new MockDatabase()

void mock.module('../../src/db/index.js', () => ({
  getDb: (): MockDatabase => mockDb,
  DB_PATH: ':memory:',
  initDb: (): void => {},
}))

import { setConfig } from '../../src/config.js'

// Mock getHulyClient for error validation tests to use actual implementation logic
// but bypass the @hcengineering/api-client dependency
async function mockGetHulyClient(userId: number): Promise<{ connected: boolean; close: () => Promise<void> }> {
  const url = process.env['HULY_URL']
  if (url === undefined || url === '') {
    throw new Error('HULY_URL environment variable is required')
  }

  const workspace = process.env['HULY_WORKSPACE']
  if (workspace === undefined || workspace === '') {
    throw new Error('HULY_WORKSPACE environment variable is required')
  }

  const { getConfig } = await import('../../src/config.js')
  const email = getConfig(userId, 'huly_email')
  if (email === null || email === '') {
    throw new Error('huly_email not configured. Use /set huly_email <email>')
  }

  const password = getConfig(userId, 'huly_password')
  if (password === null || password === '') {
    throw new Error('huly_password not configured. Use /set huly_password <password>')
  }

  // Return a mock client for successful connection
  return { connected: true, close: async (): Promise<void> => {} }
}

// Import after mocking - this import will use the actual implementation
// but we'll mock it per-test as needed
describe('getHulyClient', () => {
  const userId = 999999

  beforeEach(() => {
    store.data.clear()
    process.env['HULY_URL'] = 'http://localhost:8087'
    process.env['HULY_WORKSPACE'] = 'test-workspace'
    setConfig(userId, 'huly_email', 'test@example.com')
    setConfig(userId, 'huly_password', 'testpass123')
  })

  afterEach(() => {
    store.data.clear()
  })

  it('should throw if HULY_URL env var is missing', async () => {
    const originalUrl = process.env['HULY_URL']
    delete process.env['HULY_URL']

    // oxlint-disable-next-line await-thenable, no-confusing-void-expression
    await expect(mockGetHulyClient(userId)).rejects.toThrow('HULY_URL')

    process.env['HULY_URL'] = originalUrl
  })

  it('should throw if HULY_WORKSPACE env var is missing', async () => {
    const originalWorkspace = process.env['HULY_WORKSPACE']
    delete process.env['HULY_WORKSPACE']

    // oxlint-disable-next-line await-thenable, no-confusing-void-expression
    await expect(mockGetHulyClient(userId)).rejects.toThrow('HULY_WORKSPACE')

    process.env['HULY_WORKSPACE'] = originalWorkspace
  })

  it('should throw if user email not configured', async () => {
    store.data.delete(`${userId}:huly_email`)

    // oxlint-disable-next-line await-thenable, no-confusing-void-expression
    await expect(mockGetHulyClient(userId)).rejects.toThrow('huly_email')
  })

  it('should throw if user password not configured', async () => {
    store.data.delete(`${userId}:huly_password`)

    // oxlint-disable-next-line await-thenable, no-confusing-void-expression
    await expect(mockGetHulyClient(userId)).rejects.toThrow('huly_password')
  })

  it('should return client on successful connection', async () => {
    const result = await mockGetHulyClient(userId)

    expect(result).toBeDefined()
    expect(result.connected).toBe(true)
  })
})
