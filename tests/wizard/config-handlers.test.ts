/**
 * Tests for wizard config handlers
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mock } from 'bun:test'

import { mockDrizzle, mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Setup mocks
mockDrizzle()
mockLogger()

afterAll(() => {
  mock.restore()
})

// Import after mocking
import { setConfig } from '../../src/config.js'
import { handleConfigCallback } from '../../src/wizard/config-handlers.js'
import { deleteWizardSession } from '../../src/wizard/state.js'

type HandleConfigCallbackCtx = Parameters<typeof handleConfigCallback>[0]

function createMockCtx(
  userId: string,
  storageContextId: string,
  callbackData: string,
  editMessageTextFn: (text: string) => void,
): HandleConfigCallbackCtx {
  return {
    from: { id: userId },
    chat: { id: storageContextId },
    callbackQuery: { data: callbackData },
    answerCallbackQuery: (): Promise<void> => Promise.resolve(),
    editMessageText: (text: string): Promise<void> => {
      editMessageTextFn(text)
      return Promise.resolve()
    },
  }
}

describe('config-handlers', () => {
  const userId = 'user123'
  const storageContextId = 'ctx-456'

  beforeEach(async () => {
    await setupTestDb()
    await deleteWizardSession(userId, storageContextId)
  })

  describe('getDisplayValue masking', () => {
    test('masks sensitive values (apikey, token) when displaying', async () => {
      // Set up sensitive config values
      setConfig(storageContextId, 'llm_apikey', 'sk-secret12345')
      setConfig(storageContextId, 'kaneo_apikey', 'kaneo-secret-key')

      // Create a mock context for the callback
      const mockCtx = createMockCtx(userId, storageContextId, 'config_edit_llm_apikey', (text) => {
        // Check that the sensitive value is masked, not exposed
        expect(text).toContain('****2345')
        expect(text).not.toContain('sk-secret12345')
        expect(text).not.toContain('secret12')
      })

      await handleConfigCallback(mockCtx)
    })

    test('masks kaneo_apikey when displaying', async () => {
      // Set up sensitive config value
      setConfig(storageContextId, 'kaneo_apikey', 'my-secret-kaneo-key')

      // Create a mock context for the callback
      const mockCtx = createMockCtx(userId, storageContextId, 'config_edit_kaneo_apikey', (text) => {
        // Check that the apikey is masked (last 4 chars: -key)
        expect(text).toContain('****-key')
        expect(text).not.toContain('my-secret-kaneo-key')
        expect(text).not.toContain('my-secret')
      })

      await handleConfigCallback(mockCtx)
    })

    test('does not mask non-sensitive values', async () => {
      // Set up non-sensitive config values
      setConfig(storageContextId, 'main_model', 'gpt-4')
      setConfig(storageContextId, 'llm_baseurl', 'https://api.openai.com')

      // Create a mock context for the callback
      const mockCtx = createMockCtx(userId, storageContextId, 'config_edit_main_model', (text) => {
        // Check that non-sensitive values are shown in full
        expect(text).toContain('gpt-4')
      })

      await handleConfigCallback(mockCtx)
    })

    test('shows (not set) for unset values', async () => {
      // Create a mock context for a config key that hasn't been set
      const mockCtx = createMockCtx(userId, storageContextId, 'config_edit_main_model', (text) => {
        // Check that unset values show (not set)
        expect(text).toContain('(not set)')
      })

      await handleConfigCallback(mockCtx)
    })
  })

  describe('setupWizardForEditing singleStep mode', () => {
    test('sets singleStep flag when editing a field from /config', async () => {
      // Set up an existing config value
      setConfig(storageContextId, 'main_model', 'gpt-4-old')

      // Import session functions
      const { getWizardSession } = await import('../../src/wizard/state.js')

      const mockCtx = createMockCtx(userId, storageContextId, 'config_edit_main_model', () => {
        // Callback executed - session will be checked after
      })

      await handleConfigCallback(mockCtx)

      // Verify singleStep flag is set
      const session = getWizardSession(userId, storageContextId)
      expect(session).not.toBeNull()
      expect(session?.singleStep).toBe(true)
    })

    test('preserves existing session data when starting edit', async () => {
      // First complete a partial setup
      setConfig(storageContextId, 'llm_apikey', 'sk-existing')
      setConfig(storageContextId, 'llm_baseurl', 'https://api.existing.com')

      // Import session functions
      const { getWizardSession } = await import('../../src/wizard/state.js')

      const mockCtx = createMockCtx(userId, storageContextId, 'config_edit_main_model', () => {
        // Callback executed - session will be checked after
      })

      await handleConfigCallback(mockCtx)

      // Verify existing data is preserved
      const session = getWizardSession(userId, storageContextId)
      expect(session).not.toBeNull()
      expect(session?.data['llm_apikey']).toBe('sk-existing')
      expect(session?.data['llm_baseurl']).toBe('https://api.existing.com')
    })

    test('sets correct currentStep for the field being edited', async () => {
      // main_model is at step index 2
      const mockCtx = createMockCtx(userId, storageContextId, 'config_edit_main_model', () => {
        // Verification done after callback
      })

      await handleConfigCallback(mockCtx)

      // Verify the step is set correctly
      const { getWizardSession } = await import('../../src/wizard/state.js')
      const session = getWizardSession(userId, storageContextId)
      expect(session).not.toBeNull()
      // main_model is at step index 2
      expect(session?.currentStep).toBe(2)
    })

    test('cancels existing wizard before starting edit', async () => {
      // First create an existing wizard session
      const { createWizardSession } = await import('../../src/wizard/state.js')
      createWizardSession({
        userId,
        storageContextId,
        totalSteps: 7,
        platform: 'telegram',
        taskProvider: 'kaneo',
      })

      // Verify session exists
      const { getWizardSession } = await import('../../src/wizard/state.js')
      let sessionBefore = getWizardSession(userId, storageContextId)
      expect(sessionBefore).not.toBeNull()

      // Now trigger edit - should cancel and create new session
      const mockCtx = createMockCtx(userId, storageContextId, 'config_edit_llm_apikey', () => {
        // Callback executed
      })

      await handleConfigCallback(mockCtx)

      // Verify new session was created with singleStep
      let sessionAfter = getWizardSession(userId, storageContextId)
      expect(sessionAfter).not.toBeNull()
      expect(sessionAfter?.singleStep).toBe(true)
      // llm_apikey is at step index 0
      expect(sessionAfter?.currentStep).toBe(0)
    })
  })
})
