import { describe, expect, test } from 'bun:test'

import type { DeferredAudience, DeferredDeliveryTarget } from '../../src/chat/types.js'

describe('Deferred proactive send types', () => {
  test('supports group target with personal audience and mentions', () => {
    const audience: DeferredAudience = 'personal'
    const target: DeferredDeliveryTarget = {
      contextId: '-1001234567890',
      contextType: 'group',
      threadId: '42',
      audience,
      mentionUserIds: ['12345678'],
      createdByUserId: '12345678',
      createdByUsername: 'ki',
    }

    expect(target.contextType).toBe('group')
    expect(target.audience).toBe('personal')
    expect(target.mentionUserIds).toEqual(['12345678'])
  })

  test('supports dm target with personal audience and no mentions', () => {
    const target: DeferredDeliveryTarget = {
      contextId: '12345678',
      contextType: 'dm',
      threadId: null,
      audience: 'personal',
      mentionUserIds: [],
      createdByUserId: '12345678',
      createdByUsername: null,
    }

    expect(target.contextType).toBe('dm')
    expect(target.threadId).toBeNull()
    expect(target.mentionUserIds).toHaveLength(0)
  })

  test('supports shared audience for group context', () => {
    const target: DeferredDeliveryTarget = {
      contextId: 'chan-1',
      contextType: 'group',
      threadId: null,
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: 'u1',
      createdByUsername: 'ki',
    }

    expect(target.audience).toBe('shared')
    expect(target.mentionUserIds).toEqual([])
  })
})
