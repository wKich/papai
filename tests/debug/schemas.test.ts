import { describe, expect, test } from 'bun:test'

import { FactSchema, InstructionSchema, LogEntrySchema, safeParseSession } from '../../src/debug/schemas.js'

describe('schemas', () => {
  describe('FactSchema', () => {
    test('parses valid fact', () => {
      const fact = {
        identifier: 'task-123',
        title: 'Example Task',
        url: 'https://example.com/task/123',
        lastSeen: '2024-01-15T10:30:00.000Z',
      }
      const result = FactSchema.safeParse(fact)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.identifier).toBe('task-123')
        expect(result.data.title).toBe('Example Task')
      }
    })
  })

  describe('InstructionSchema', () => {
    test('parses valid instruction', () => {
      const instruction = {
        id: 'inst-1',
        text: 'Be helpful and concise',
        createdAt: '2024-01-15T10:30:00.000Z',
      }
      const result = InstructionSchema.safeParse(instruction)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.text).toBe('Be helpful and concise')
      }
    })
  })

  describe('LogEntrySchema', () => {
    test('parses log entry with structured properties', () => {
      const entry = {
        time: '2024-01-15T10:30:00.000Z',
        level: 30,
        msg: 'Processing completed',
        scope: 'test-module',
        userId: 'user-123',
        count: 42,
        nested: { key: 'value' },
      }
      const result = LogEntrySchema.safeParse(entry)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.msg).toBe('Processing completed')
        expect(result.data['userId']).toBe('user-123')
        expect(result.data['count']).toBe(42)
      }
    })

    test('parses basic log entry without extra properties', () => {
      const entry = {
        time: '2024-01-15T10:30:00.000Z',
        level: 30,
        msg: 'Simple message',
      }
      const result = LogEntrySchema.safeParse(entry)
      expect(result.success).toBe(true)
    })
  })

  describe('safeParseSession', () => {
    test('parses session with full data', () => {
      const session = {
        userId: 'user-123',
        lastAccessed: Date.now(),
        historyLength: 5,
        factsCount: 2,
        summary: 'Test summary',
        configKeys: ['key1', 'key2'],
        workspaceId: 'ws-123',
        facts: [
          {
            identifier: 'task-1',
            title: 'Task One',
            url: 'https://example.com/1',
            lastSeen: '2024-01-15T10:30:00.000Z',
          },
        ],
        config: { key1: 'value1', key2: null },
        hasTools: true,
        instructionsCount: 3,
      }
      const result = safeParseSession(session)
      expect(result).not.toBeNull()
      if (result !== null) {
        expect(result.userId).toBe('user-123')
        expect(result.facts).toHaveLength(1)
        expect(result.config?.['key1']).toBe('value1')
        expect(result.hasTools).toBe(true)
      }
    })

    test('parses session without optional full data', () => {
      const session = {
        userId: 'user-123',
        lastAccessed: Date.now(),
        historyLength: 0,
        factsCount: 0,
        summary: null,
        configKeys: [],
        workspaceId: null,
      }
      const result = safeParseSession(session)
      expect(result).not.toBeNull()
    })
  })
})
