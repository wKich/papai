import { beforeEach, describe, expect, test } from 'bun:test'

import { eq, and } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { groupAdminObservations, knownGroupContexts } from '../../src/db/schema.js'
import {
  getGroupAdminObservation,
  listAdminGroupContextsForUser,
  listKnownGroupContexts,
  upsertGroupAdminObservation,
  upsertKnownGroupContext,
} from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('group-settings registry', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('upserts known group contexts by root context id', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })

    const groups = listKnownGroupContexts()
    expect(groups).toHaveLength(1)
    expect(groups[0]?.contextId).toBe('group-1')
    expect(groups[0]?.displayName).toBe('Operations')
    expect(groups[0]?.parentName).toBe('Platform')
  })

  test('stores the latest admin observation per group and user', () => {
    upsertGroupAdminObservation({
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    const observation = getGroupAdminObservation('group-1', 'user-1')
    expect(observation?.username).toBe('alice')
    expect(observation?.isAdmin).toBe(true)
  })

  test('lists admin groups for a user with a single join query', () => {
    upsertKnownGroupContext({ contextId: 'g-1', provider: 'telegram', displayName: 'Alpha', parentName: null })
    upsertKnownGroupContext({ contextId: 'g-2', provider: 'telegram', displayName: 'Beta', parentName: null })
    upsertKnownGroupContext({ contextId: 'g-3', provider: 'telegram', displayName: 'Gamma', parentName: null })
    upsertGroupAdminObservation({ contextId: 'g-1', userId: 'u-1', username: 'alice', isAdmin: true })
    upsertGroupAdminObservation({ contextId: 'g-2', userId: 'u-1', username: 'alice', isAdmin: false })
    upsertGroupAdminObservation({ contextId: 'g-3', userId: 'u-1', username: 'alice', isAdmin: true })

    const groups = listAdminGroupContextsForUser('u-1')
    expect(groups.map((g) => g.contextId)).toEqual(['g-1', 'g-3'])
  })

  test('returns empty array when user has no admin groups', () => {
    upsertKnownGroupContext({ contextId: 'g-1', provider: 'telegram', displayName: 'Alpha', parentName: null })
    upsertGroupAdminObservation({ contextId: 'g-1', userId: 'u-1', username: 'alice', isAdmin: false })

    expect(listAdminGroupContextsForUser('u-1')).toEqual([])
    expect(listAdminGroupContextsForUser('nonexistent')).toEqual([])
  })

  test('skips known group context upsert when lastSeenAt is within throttle window', () => {
    upsertKnownGroupContext({ contextId: 'g-t', provider: 'telegram', displayName: 'Ops', parentName: null })
    const first = listKnownGroupContexts().find((g) => g.contextId === 'g-t')!

    upsertKnownGroupContext({ contextId: 'g-t', provider: 'telegram', displayName: 'Ops', parentName: null })
    const second = listKnownGroupContexts().find((g) => g.contextId === 'g-t')!

    expect(second.lastSeenAt).toBe(first.lastSeenAt)
  })

  test('updates known group context when lastSeenAt is outside throttle window', () => {
    upsertKnownGroupContext({ contextId: 'g-e', provider: 'telegram', displayName: 'Ops', parentName: null })

    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    getDrizzleDb()
      .update(knownGroupContexts)
      .set({ lastSeenAt: staleTime })
      .where(eq(knownGroupContexts.contextId, 'g-e'))
      .run()

    upsertKnownGroupContext({ contextId: 'g-e', provider: 'telegram', displayName: 'Ops', parentName: null })
    const after = listKnownGroupContexts().find((g) => g.contextId === 'g-e')!

    expect(after.lastSeenAt > staleTime).toBe(true)
  })

  test('skips admin observation upsert when lastSeenAt is within throttle window', () => {
    upsertGroupAdminObservation({ contextId: 'g-t', userId: 'u-1', username: 'alice', isAdmin: true })
    const first = getGroupAdminObservation('g-t', 'u-1')!

    upsertGroupAdminObservation({ contextId: 'g-t', userId: 'u-1', username: 'alice', isAdmin: true })
    const second = getGroupAdminObservation('g-t', 'u-1')!

    expect(second.lastSeenAt).toBe(first.lastSeenAt)
  })

  test('updates admin observation when lastSeenAt is outside throttle window', () => {
    upsertGroupAdminObservation({ contextId: 'g-e', userId: 'u-1', username: 'alice', isAdmin: true })

    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    getDrizzleDb()
      .update(groupAdminObservations)
      .set({ lastSeenAt: staleTime })
      .where(and(eq(groupAdminObservations.contextId, 'g-e'), eq(groupAdminObservations.userId, 'u-1')))
      .run()

    upsertGroupAdminObservation({ contextId: 'g-e', userId: 'u-1', username: 'bob', isAdmin: false })
    const after = getGroupAdminObservation('g-e', 'u-1')!

    expect(after.lastSeenAt > staleTime).toBe(true)
    expect(after.username).toBe('bob')
    expect(after.isAdmin).toBe(false)
  })
})
