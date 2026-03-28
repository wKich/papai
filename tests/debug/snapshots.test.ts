import { describe, expect, test } from 'bun:test'

import { getPollerSnapshot } from '../../src/deferred-prompts/poller.js'
import { getMessageCacheSnapshot } from '../../src/message-cache/cache.js'
import { getPendingWritesCount, getIsFlushScheduled } from '../../src/message-cache/persistence.js'
import { getSchedulerSnapshot } from '../../src/scheduler.js'

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

describe('getSchedulerSnapshot', () => {
  test('returns snapshot with expected shape', () => {
    const snap = getSchedulerSnapshot()
    expect(snap).toHaveProperty('running')
    expect(snap).toHaveProperty('tickCount')
    expect(snap).toHaveProperty('tickIntervalMs')
    expect(snap).toHaveProperty('heartbeatInterval')
    expect(snap).toHaveProperty('activeTickInProgress')
    expect(snap).toHaveProperty('taskProvider')
    expect(typeof snap.running).toBe('boolean')
    expect(typeof snap.tickCount).toBe('number')
    expect(snap.tickIntervalMs).toBe(60_000)
    expect(snap.heartbeatInterval).toBe(60)
  })

  test('reports not running when scheduler is stopped', () => {
    const snap = getSchedulerSnapshot()
    expect(snap.running).toBe(false)
    expect(snap.activeTickInProgress).toBe(false)
  })
})

describe('getPollerSnapshot', () => {
  test('returns snapshot with expected shape', () => {
    const snap = getPollerSnapshot()
    expect(snap).toHaveProperty('scheduledRunning')
    expect(snap).toHaveProperty('alertsRunning')
    expect(snap).toHaveProperty('scheduledIntervalMs')
    expect(snap).toHaveProperty('alertIntervalMs')
    expect(snap).toHaveProperty('maxConcurrentLlmCalls')
    expect(snap).toHaveProperty('maxConcurrentUsers')
    expect(snap.scheduledIntervalMs).toBe(60_000)
    expect(snap.alertIntervalMs).toBe(300_000)
    expect(snap.maxConcurrentLlmCalls).toBe(5)
    expect(snap.maxConcurrentUsers).toBe(10)
  })

  test('reports not running when pollers are stopped', () => {
    const snap = getPollerSnapshot()
    expect(snap.scheduledRunning).toBe(false)
    expect(snap.alertsRunning).toBe(false)
  })
})
