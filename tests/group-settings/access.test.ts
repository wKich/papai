import { beforeEach, describe, expect, test } from 'bun:test'

import { listManageableGroups, matchManageableGroup } from '../../src/group-settings/access.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('group settings access', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('lists only groups where the user is a known admin', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertKnownGroupContext({
      contextId: 'group-2',
      provider: 'telegram',
      displayName: 'Security',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })
    upsertGroupAdminObservation({
      contextId: 'group-2',
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
    })

    expect(listManageableGroups('user-1').map((group) => group.contextId)).toEqual(['group-1'])
  })

  test('matches by context id and display name and reports ambiguity', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertKnownGroupContext({
      contextId: 'group-2',
      provider: 'telegram',
      displayName: 'Operations Europe',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })
    upsertGroupAdminObservation({
      contextId: 'group-2',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    const exactMatch = matchManageableGroup('user-1', 'group-1')
    expect(exactMatch.kind).toBe('match')
    if (exactMatch.kind === 'match') {
      expect(exactMatch.group.contextId).toBe('group-1')
    }

    const ambiguousMatch = matchManageableGroup('user-1', 'operations')
    expect(ambiguousMatch.kind).toBe('ambiguous')
    if (ambiguousMatch.kind === 'ambiguous') {
      expect(ambiguousMatch.matches.map((group) => group.contextId)).toEqual(['group-1', 'group-2'])
    }
  })
})
