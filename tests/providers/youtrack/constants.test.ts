import { describe, expect, test } from 'bun:test'

import { YOUTRACK_CAPABILITIES } from '../../../src/providers/youtrack/constants.js'

describe('YOUTRACK_CAPABILITIES', () => {
  test('includes projects.delete capability', () => {
    expect(YOUTRACK_CAPABILITIES.has('projects.delete')).toBe(true)
  })

  test('includes Phase 4 collaboration capabilities', () => {
    expect(YOUTRACK_CAPABILITIES.has('tasks.watchers')).toBe(true)
    expect(YOUTRACK_CAPABILITIES.has('tasks.votes')).toBe(true)
    expect(YOUTRACK_CAPABILITIES.has('tasks.visibility')).toBe(true)
    expect(YOUTRACK_CAPABILITIES.has('comments.reactions')).toBe(true)
    expect(YOUTRACK_CAPABILITIES.has('projects.team')).toBe(true)
  })
})
