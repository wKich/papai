import { afterAll, describe, test, expect, beforeEach, mock } from 'bun:test'

import { mockLogger, mockDrizzle, setupTestDb } from './utils/test-helpers.js'

mockLogger()
mockDrizzle()

import { _userCaches } from '../src/cache.js'
import { saveInstruction, buildInstructionsBlock } from '../src/instructions.js'

beforeEach(async () => {
  _userCaches.clear()
  await setupTestDb()
})

describe('buildInstructionsBlock', () => {
  test('includes custom instructions block when instructions exist', () => {
    saveInstruction('ctx-1', 'Always reply in Spanish')
    saveInstruction('ctx-1', 'Use high priority by default')
    const block = buildInstructionsBlock('ctx-1')
    expect(block).toContain('=== Custom instructions ===')
    expect(block).toContain('- Always reply in Spanish')
    expect(block).toContain('- Use high priority by default')
  })

  test('returns empty string when no instructions', () => {
    const block = buildInstructionsBlock('ctx-1')
    expect(block).toBe('')
  })

  test('formats instructions as bullet list', () => {
    saveInstruction('ctx-1', 'Always reply in Spanish')
    const block = buildInstructionsBlock('ctx-1')
    expect(block).toStartWith('=== Custom instructions ===\n- Always reply in Spanish')
  })
})

afterAll(() => {
  mock.restore()
})
