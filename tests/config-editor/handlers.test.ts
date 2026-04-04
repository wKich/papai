/**
 * Tests for config-editor handlers
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleEditorCallback, handleEditorMessage, startEditor } from '../../src/config-editor/handlers.js'
import { deleteEditorSession } from '../../src/config-editor/state.js'
import { getConfig, setConfig } from '../../src/config.js'
import type { ConfigKey } from '../../src/types/config.js'
import { mockDrizzle, mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('config-editor handlers', () => {
  const userId = 'user123'
  const storageContextId = 'ctx456'

  beforeEach(async () => {
    mockLogger()
    mockDrizzle()
    await setupTestDb()
    deleteEditorSession(userId, storageContextId)
  })

  describe('startEditor', () => {
    test('returns edit prompt for the specified key', () => {
      const result = startEditor(userId, storageContextId, 'llm_apikey')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('Edit LLM API Key')
      expect(result.response).toContain('(not set)')
      expect(result.buttons).toBeDefined()
      expect(result.buttons?.length).toBeGreaterThan(0)
    })

    test('shows masked current value if set', () => {
      setConfig(storageContextId, 'llm_apikey', 'sk-secret12345')

      const result = startEditor(userId, storageContextId, 'llm_apikey')

      expect(result.response).toContain('****2345')
      expect(result.response).not.toContain('sk-secret12345')
    })

    test('shows unmasked value for non-sensitive keys', () => {
      setConfig(storageContextId, 'main_model', 'gpt-4')

      const result = startEditor(userId, storageContextId, 'main_model')

      expect(result.response).toContain('gpt-4')
    })
  })

  describe('handleEditorCallback', () => {
    test('handles edit action - starts editing', () => {
      const result = handleEditorCallback(userId, storageContextId, 'edit', 'llm_apikey')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('Enter new value')
      expect(result.buttons?.some((btn: { action: string }) => btn.action === 'cancel')).toBe(true)
      expect(result.buttons?.some((btn: { action: string }) => btn.action === 'back')).toBe(true)
    })

    test('handles cancel action - deletes session', () => {
      // First start an editor
      startEditor(userId, storageContextId, 'llm_apikey')

      const result = handleEditorCallback(userId, storageContextId, 'cancel')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('cancelled')
    })

    test('handles back action - returns to config list', () => {
      const result = handleEditorCallback(userId, storageContextId, 'back')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('Configuration')
    })

    test('handles save action - saves value and returns to config', () => {
      // Start editor and set pending value
      startEditor(userId, storageContextId, 'main_model')

      // Simulate user entering a value
      handleEditorMessage(userId, storageContextId, 'gpt-4o')

      // Now save
      const result = handleEditorCallback(userId, storageContextId, 'save', 'main_model')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('saved')

      // Verify it was actually saved
      const saved = getConfig(storageContextId, 'main_model')
      expect(saved).toBe('gpt-4o')
    })

    test('handles setup action - returns setup instruction', () => {
      const result = handleEditorCallback(userId, storageContextId, 'setup')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('/setup')
    })

    test('returns not handled when key is undefined for edit action', () => {
      const result = handleEditorCallback(userId, storageContextId, 'edit', undefined)

      expect(result.handled).toBe(false)
    })
  })

  describe('handleEditorMessage', () => {
    test('returns validation error for invalid value', () => {
      startEditor(userId, storageContextId, 'llm_baseurl')

      const result = handleEditorMessage(userId, storageContextId, 'not-a-url')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('valid URL')
      expect(result.buttons?.some((btn: { action: string }) => btn.action === 'cancel')).toBe(true)
    })

    test('returns confirmation prompt for valid value', () => {
      startEditor(userId, storageContextId, 'main_model')

      const result = handleEditorMessage(userId, storageContextId, 'gpt-4')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('gpt-4')
      expect(result.buttons?.some((btn: { action: string }) => btn.action === 'save')).toBe(true)
      expect(result.buttons?.some((btn: { action: string }) => btn.action === 'cancel')).toBe(true)
      expect(result.buttons?.some((btn: { action: string }) => btn.action === 'back')).toBe(true)
    })

    test('returns not handled when no active editor', () => {
      const result = handleEditorMessage(userId, storageContextId, 'some-value')

      expect(result.handled).toBe(false)
    })
  })

  describe('config key display names', () => {
    const testCases: Array<{ key: ConfigKey; expectedText: string }> = [
      { key: 'llm_apikey', expectedText: 'LLM API Key' },
      { key: 'llm_baseurl', expectedText: 'Base URL' },
      { key: 'main_model', expectedText: 'Main Model' },
      { key: 'small_model', expectedText: 'Small Model' },
      { key: 'embedding_model', expectedText: 'Embedding Model' },
      { key: 'timezone', expectedText: 'Timezone' },
    ]

    for (const { key, expectedText } of testCases) {
      test(`shows correct display name for ${key}`, () => {
        const result = startEditor(userId, storageContextId, key)
        expect(result.response).toContain(expectedText)
      })
    }

    test('shows correct display name for kaneo_apikey', () => {
      const result = startEditor(userId, storageContextId, 'kaneo_apikey')
      expect(result.response).toContain('Kaneo API Key')
    })

    test('shows correct display name for youtrack_token', () => {
      const result = startEditor(userId, storageContextId, 'youtrack_token')
      expect(result.response).toContain('YouTrack Token')
    })
  })
})
