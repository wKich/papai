import { Database } from 'bun:sqlite'
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../../src/db/schema.js'
import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: Database

void mock.module('../../src/db/drizzle.js', () => ({
  getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => testDb,
}))

import { pruneBackgroundEvents, recordBackgroundEvent } from '../../src/deferred-prompts/background-events.js'

const setupDb = (): void => {
  testSqlite = new Database(':memory:')
  testSqlite.run('PRAGMA journal_mode=WAL')
  testDb = drizzle(testSqlite, { schema })
  testSqlite.run(`
    CREATE TABLE background_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      injected_at TEXT
    )
  `)
  testSqlite.run('CREATE INDEX idx_background_events_user_injected ON background_events(user_id, injected_at)')
}

beforeEach(setupDb)
afterAll(() => {
  mock.restore()
})

describe('recordBackgroundEvent', () => {
  test('inserts a row with injectedAt null', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'create report', 'Created report task.')
    const rows = testSqlite
      .query<{ user_id: string; type: string; injected_at: string | null }, []>(
        'SELECT user_id, type, injected_at FROM background_events',
      )
      .all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.user_id).toBe('user-1')
    expect(rows[0]!.type).toBe('scheduled')
    expect(rows[0]!.injected_at).toBeNull()
  })

  test('caps response at 2000 characters', () => {
    const longResponse = 'x'.repeat(3000)
    recordBackgroundEvent('user-1', 'alert', 'check overdue', longResponse)
    const row = testSqlite.query<{ response: string }, []>('SELECT response FROM background_events').get()
    expect(row!.response.length).toBe(2000)
  })

  test('stores full response when under 2000 characters', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'do thing', 'short response')
    const row = testSqlite.query<{ response: string }, []>('SELECT response FROM background_events').get()
    expect(row!.response).toBe('short response')
  })
})

describe('pruneBackgroundEvents', () => {
  test('deletes events older than the given days', () => {
    testSqlite.run(`INSERT INTO background_events (id, user_id, type, prompt, response, created_at, injected_at)
      VALUES ('old', 'user-1', 'scheduled', 'old task', 'Done.', datetime('now', '-31 days'), datetime('now', '-31 days'))`)
    recordBackgroundEvent('user-1', 'scheduled', 'new task', 'Done.')

    pruneBackgroundEvents(30)

    const rows = testSqlite.query<{ id: string }, []>('SELECT id FROM background_events').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).not.toBe('old')
  })

  test('keeps events within retention period', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'recent', 'Done.')
    pruneBackgroundEvents(30)
    const rows = testSqlite.query<{ id: string }, []>('SELECT id FROM background_events').all()
    expect(rows).toHaveLength(1)
  })
})
