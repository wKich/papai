import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration020WebFetch } from '../../../src/db/migrations/020_web_fetch.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name)

const getIndexNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((row) => row.name)

describe('migration020WebFetch', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates web_cache table', () => {
    migration020WebFetch.up(db)

    const tableNames = getTableNames(db)
    expect(tableNames).toContain('web_cache')
  })

  test('creates web_rate_limit table', () => {
    migration020WebFetch.up(db)

    const tableNames = getTableNames(db)
    expect(tableNames).toContain('web_rate_limit')
  })

  test('creates index on web_cache expires_at', () => {
    migration020WebFetch.up(db)

    const indexNames = getIndexNames(db)
    expect(indexNames).toContain('idx_web_cache_expires')
  })
})
