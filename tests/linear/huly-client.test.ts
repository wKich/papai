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
// Import after mocking
import { getHulyClient } from '../../src/linear/huly-client.js'

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
    await expect(getHulyClient(userId)).rejects.toThrow('HULY_URL')

    process.env['HULY_URL'] = originalUrl
  })

  it('should throw if HULY_WORKSPACE env var is missing', async () => {
    const originalWorkspace = process.env['HULY_WORKSPACE']
    delete process.env['HULY_WORKSPACE']

    // oxlint-disable-next-line await-thenable, no-confusing-void-expression
    await expect(getHulyClient(userId)).rejects.toThrow('HULY_WORKSPACE')

    process.env['HULY_WORKSPACE'] = originalWorkspace
  })

  it('should throw if user email not configured', async () => {
    store.data.delete(`${userId}:huly_email`)

    // oxlint-disable-next-line await-thenable, no-confusing-void-expression
    await expect(getHulyClient(userId)).rejects.toThrow('huly_email')
  })

  it('should throw if user password not configured', async () => {
    store.data.delete(`${userId}:huly_password`)

    // oxlint-disable-next-line await-thenable, no-confusing-void-expression
    await expect(getHulyClient(userId)).rejects.toThrow('huly_password')
  })

  it('should return client on successful connection', async () => {
    const mockClient = { connected: true }
    const mockConnect = mock((): { connected: boolean } => mockClient)

    void mock.module('@hcengineering/api-client', () => ({
      connect: mockConnect,
      NodeWebSocketFactory: (): void => {},
    }))

    const { getHulyClient: getHulyClientFresh } = await import('../../src/linear/huly-client.js')

    const result = await getHulyClientFresh(userId)

    expect(result).toBe(mockClient)
    expect(mockConnect).toHaveBeenCalledWith(
      'http://localhost:8087',
      expect.objectContaining({
        email: 'test@example.com',
        password: 'testpass123',
        workspace: 'test-workspace',
        connectionTimeout: 30000,
      }),
    )
  })
})
