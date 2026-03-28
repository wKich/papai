import { describe, expect, test } from 'bun:test'

import { getMessageCacheSnapshot } from '../../src/message-cache/cache.js'
import { getPendingWritesCount, getIsFlushScheduled } from '../../src/message-cache/persistence.js'

describe('message-cache persistence accessors', () => {
  test('getPendingWritesCount returns a number', () => {
    const count = getPendingWritesCount()
    expect(typeof count).toBe('number')
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('getIsFlushScheduled returns a boolean', () => {
    const scheduled = getIsFlushScheduled()
    expect(typeof scheduled).toBe('boolean')
  })
})

describe('getMessageCacheSnapshot', () => {
  test('returns snapshot with expected shape', () => {
    const snap = getMessageCacheSnapshot()
    expect(snap).toHaveProperty('size')
    expect(snap).toHaveProperty('ttlMs')
    expect(snap).toHaveProperty('pendingWrites')
    expect(snap).toHaveProperty('isFlushScheduled')
    expect(typeof snap.size).toBe('number')
    expect(typeof snap.ttlMs).toBe('number')
    expect(snap.ttlMs).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
