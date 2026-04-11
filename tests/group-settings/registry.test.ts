import { beforeEach, describe, expect, test } from 'bun:test'

import {
  getGroupAdminObservation,
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
})
