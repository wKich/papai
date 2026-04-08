import { describe, expect, test } from 'bun:test'

import { YOUTRACK_CAPABILITIES } from '../../../src/providers/youtrack/constants.js'

describe('YOUTRACK_CAPABILITIES', () => {
  test('includes projects.delete capability', () => {
    expect(YOUTRACK_CAPABILITIES.has('projects.delete')).toBe(true)
  })
})
