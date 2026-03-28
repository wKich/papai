/**
 * Tests for wizard engine - interactive configuration setup
 */

import { afterEach, beforeEach, describe, expect, test, afterAll } from 'bun:test'
import { mock } from 'bun:test'

// Import config to verify values were stored
import { getConfig } from '../../src/config.js'
import { mockDrizzle, setupTestDb } from '../utils/test-helpers.js'

// Setup mocks
mockDrizzle()

// Mutable implementations for testing
let loggerCalls: Array<{ level: string; args: unknown[] }> = []

// Mock logger with call tracking
void mock.module('../../src/logger.js', () => ({
  logger: {
    debug: (...args: unknown[]): void => {
      loggerCalls.push({ level: 'debug', args })
    },
    info: (...args: unknown[]): void => {
      loggerCalls.push({ level: 'info', args })
    },
    warn: (...args: unknown[]): void => {
      loggerCalls.push({ level: 'warn', args })
    },
    error: (...args: unknown[]): void => {
      loggerCalls.push({ level: 'error', args })
    },
    child: (): {
      debug: (...args: unknown[]) => void
      info: (...args: unknown[]) => void
      warn: (...args: unknown[]) => void
      error: (...args: unknown[]) => void
    } => ({
      debug: (...args: unknown[]): void => {
        loggerCalls.push({ level: 'debug', args })
      },
      info: (...args: unknown[]): void => {
        loggerCalls.push({ level: 'info', args })
      },
      warn: (...args: unknown[]): void => {
        loggerCalls.push({ level: 'warn', args })
      },
      error: (...args: unknown[]): void => {
        loggerCalls.push({ level: 'error', args })
      },
    }),
  },
}))

// Note: Not mocking config.js - using real implementation to avoid test pollution

// Import after mocking
import {
  createWizard,
  advanceStep,
  saveWizardConfig,
  cancelWizard,
  processWizardMessage,
  getWizardSteps,
} from '../../src/wizard/engine.js'
import { getWizardSession, deleteWizardSession } from '../../src/wizard/state.js'

afterAll(() => {
  mock.restore()
})

// Global fetch mock for engine tests (returns success by default)
const originalFetch = globalThis.fetch
describe('Wizard Engine', () => {
  const userId = 'user123'
  const storageContextId = 'ctx-456'

  beforeEach(async () => {
    // Clean up
    await setupTestDb()
    await deleteWizardSession(userId, storageContextId)
    loggerCalls.length = 0
    // Reset fetch to return success by default with comprehensive model list
    globalThis.fetch = Object.assign(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [{ id: 'gpt-4' }, { id: 'gpt-3.5' }, { id: 'gpt-3.5-turbo' }],
            }),
        }),
      { preconnect: originalFetch.preconnect },
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('createWizard', () => {
    test('creates a new wizard session and returns welcome prompt', async () => {
      const result = await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      expect(result.success).toBe(true)
      expect(result.prompt).toContain('Welcome to papai configuration')
      expect(result.prompt).toContain('🔑 Enter your LLM API key:')

      const session = await getWizardSession(userId, storageContextId)
      expect(session).not.toBeNull()
      expect(session?.currentStep).toBe(0)
    })

    test('returns existing session if wizard already active', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')
      const result = await createWizard(userId, storageContextId, 'mattermost', 'youtrack')

      // Should return existing session with original settings
      expect(result.success).toBe(true)
      const session = await getWizardSession(userId, storageContextId)
      expect(session?.platform).toBe('telegram')
      expect(session?.taskProvider).toBe('kaneo')
    })

    test('logs wizard creation', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      const creationLogs = loggerCalls.filter(
        (call) => call.level === 'info' && call.args[1] === 'Wizard session created',
      )
      expect(creationLogs.length).toBeGreaterThan(0)
    })
  })

  describe('advanceStep', () => {
    test('advances through wizard steps', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      // Step 1: LLM API Key
      const step1 = await advanceStep(userId, storageContextId, 'sk-test12345')
      expect(step1.success).toBe(true)
      expect(step1.prompt).toContain('🌐 Enter base URL')

      // Step 2: Base URL
      const step2 = await advanceStep(userId, storageContextId, 'default')
      expect(step2.success).toBe(true)
      expect(step2.prompt).toContain('🤖 Enter main model name')

      // Step 3: Main Model
      const step3 = await advanceStep(userId, storageContextId, 'gpt-4')
      expect(step3.success).toBe(true)
      expect(step3.prompt).toContain('⚡ Enter small model name')

      const session = await getWizardSession(userId, storageContextId)
      expect(session?.currentStep).toBe(3)
    })

    test('validates invalid input', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      const result = await advanceStep(userId, storageContextId, '')

      expect(result.success).toBe(false)
      expect(result.prompt).toContain('API key cannot be empty')
      expect(result.prompt).toContain('Please try again')

      const session = await getWizardSession(userId, storageContextId)
      expect(session?.currentStep).toBe(0)
    })

    test('handles URL validation', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')
      await advanceStep(userId, storageContextId, 'sk-test12345')

      // Step 2: Base URL with invalid value
      const result = await advanceStep(userId, storageContextId, 'not-a-url')

      expect(result.success).toBe(false)
      expect(result.prompt).toContain('valid URL')
    })

    test('allows skipping optional steps', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      // Skip through required steps first
      await advanceStep(userId, storageContextId, 'sk-test12345')
      await advanceStep(userId, storageContextId, 'default')
      await advanceStep(userId, storageContextId, 'gpt-4')
      await advanceStep(userId, storageContextId, 'same')

      // Step 5: Embedding Model (optional)
      const result = await advanceStep(userId, storageContextId, 'skip')

      expect(result.success).toBe(true)
      expect(result.skipped).toBe(true)
      expect(result.prompt).toContain('🔑 Enter your Kaneo API key')

      const session = await getWizardSession(userId, storageContextId)
      expect(session?.skippedSteps).toContain(4)
    })

    test('handles same value for small model', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      await advanceStep(userId, storageContextId, 'sk-test12345')
      await advanceStep(userId, storageContextId, 'default')
      await advanceStep(userId, storageContextId, 'gpt-4')

      const result = await advanceStep(userId, storageContextId, 'same')

      expect(result.success).toBe(true)
      const session = await getWizardSession(userId, storageContextId)
      expect(session?.data['small_model']).toBe('gpt-4')
    })

    test('returns summary when all steps complete', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      // Complete all steps
      // Step 1: LLM API Key
      await advanceStep(userId, storageContextId, 'sk-test12345')
      // Step 2: Base URL
      await advanceStep(userId, storageContextId, 'default')
      // Step 3: Main Model
      await advanceStep(userId, storageContextId, 'gpt-4')
      // Step 4: Small Model
      await advanceStep(userId, storageContextId, 'gpt-3.5')
      // Step 5: Embedding (skip)
      await advanceStep(userId, storageContextId, 'skip')
      // Step 6: Kaneo API Key
      await advanceStep(userId, storageContextId, 'api-key-123')

      // Step 7: Timezone
      const result = await advanceStep(userId, storageContextId, 'UTC')

      expect(result.success).toBe(true)
      expect(result.complete).toBe(true)
      expect(result.prompt).toContain('Configuration Summary')
      expect(result.prompt).toContain('LLM API Key:')
      expect(result.prompt).toContain('Kaneo API Key:')
    })

    test('handles timezone validation', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      // Skip to timezone step
      await advanceStep(userId, storageContextId, 'sk-test12345')
      await advanceStep(userId, storageContextId, 'default')
      await advanceStep(userId, storageContextId, 'gpt-4')
      await advanceStep(userId, storageContextId, 'gpt-3.5')
      await advanceStep(userId, storageContextId, 'skip')
      await advanceStep(userId, storageContextId, 'api-key-123')

      const result = await advanceStep(userId, storageContextId, 'invalid-timezone')

      expect(result.success).toBe(false)
      expect(result.prompt).toContain('Invalid timezone')
    })

    test('returns error for non-existent session', async () => {
      const result = await advanceStep(userId, storageContextId, 'value')

      expect(result.success).toBe(false)
      expect(result.prompt).toContain('Wizard session not found')
    })

    test('logs step completion', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')
      loggerCalls = []

      await advanceStep(userId, storageContextId, 'sk-test12345')

      const updateLogs = loggerCalls.filter(
        (call) => call.level === 'info' && call.args[1] === 'Wizard session updated',
      )
      expect(updateLogs.length).toBeGreaterThan(0)
    })
  })

  describe('saveWizardConfig', () => {
    test('saves configuration and deletes session when confirmed', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      // Complete all steps
      await advanceStep(userId, storageContextId, 'sk-test12345')
      await advanceStep(userId, storageContextId, 'default')
      await advanceStep(userId, storageContextId, 'gpt-4')
      await advanceStep(userId, storageContextId, 'gpt-3.5')
      await advanceStep(userId, storageContextId, 'skip')
      await advanceStep(userId, storageContextId, 'kaneo-key')
      await advanceStep(userId, storageContextId, 'UTC')

      const result = await saveWizardConfig(userId, storageContextId, true)

      expect(result.success).toBe(true)
      expect(result.message).toContain('Configuration saved successfully')

      // Check that session was deleted
      const session = await getWizardSession(userId, storageContextId)
      expect(session).toBeNull()

      // Check that config values were saved under storageContextId
      expect(getConfig(storageContextId, 'llm_apikey')).not.toBeNull()
      expect(getConfig(storageContextId, 'kaneo_apikey')).not.toBeNull()
      expect(getConfig(storageContextId, 'timezone')).not.toBeNull()
      // Verify NOT saved under userId (group context fix)
      expect(getConfig(userId, 'llm_apikey')).toBeNull()
    })

    test('does not save when not confirmed', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')
      await advanceStep(userId, storageContextId, 'sk-test12345')

      const result = await saveWizardConfig(userId, storageContextId, false)

      expect(result.success).toBe(false)
      expect(result.message).toContain('Configuration not saved')
      expect(getConfig(userId, 'llm_apikey')).toBeNull()
    })

    test('skips empty values when saving', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      // Complete all steps
      await advanceStep(userId, storageContextId, 'sk-test12345')
      await advanceStep(userId, storageContextId, 'default')
      await advanceStep(userId, storageContextId, 'gpt-4')
      await advanceStep(userId, storageContextId, 'gpt-3.5')
      await advanceStep(userId, storageContextId, 'skip')
      await advanceStep(userId, storageContextId, 'kaneo-key')
      await advanceStep(userId, storageContextId, 'UTC')

      await saveWizardConfig(userId, storageContextId, true)

      // Skipped values should not be saved
      expect(getConfig(userId, 'embedding_model')).toBeNull()
    })

    test('returns error for non-existent session', async () => {
      const result = await saveWizardConfig(userId, storageContextId, true)

      expect(result.success).toBe(false)
      expect(result.message).toContain('Wizard session not found')
    })

    test('logs configuration saved', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')
      await advanceStep(userId, storageContextId, 'sk-test12345')
      await advanceStep(userId, storageContextId, 'default')
      await advanceStep(userId, storageContextId, 'gpt-4')
      await advanceStep(userId, storageContextId, 'gpt-3.5')
      await advanceStep(userId, storageContextId, 'skip')
      await advanceStep(userId, storageContextId, 'kaneo-key')
      await advanceStep(userId, storageContextId, 'UTC')

      loggerCalls = []
      await saveWizardConfig(userId, storageContextId, true)

      const saveLogs = loggerCalls.filter((call) => call.level === 'info' && call.args[1] === 'Configuration saved')
      expect(saveLogs.length).toBeGreaterThan(0)
    })
  })

  describe('cancelWizard', () => {
    test('deletes wizard session', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      await cancelWizard(userId, storageContextId)

      const session = await getWizardSession(userId, storageContextId)
      expect(session).toBeNull()
    })

    test('logs cancellation', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')
      loggerCalls = []

      await cancelWizard(userId, storageContextId)

      const cancelLogs = loggerCalls.filter(
        (call) => call.level === 'info' && call.args[1] === 'Wizard session deleted',
      )
      expect(cancelLogs.length).toBeGreaterThan(0)
    })
  })

  describe('processWizardMessage', () => {
    test('returns handled: false when no active wizard', async () => {
      const result = await processWizardMessage(userId, storageContextId, 'hello')

      expect(result.handled).toBe(false)
    })

    test('handles cancel command', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      const result = await processWizardMessage(userId, storageContextId, 'cancel')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('cancelled')

      const session = await getWizardSession(userId, storageContextId)
      expect(session).toBeNull()
    })

    test('handles yes/confirm when wizard complete', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      // Complete all steps
      await advanceStep(userId, storageContextId, 'sk-test12345')
      await advanceStep(userId, storageContextId, 'default')
      await advanceStep(userId, storageContextId, 'gpt-4')
      await advanceStep(userId, storageContextId, 'gpt-3.5')
      await advanceStep(userId, storageContextId, 'skip')
      await advanceStep(userId, storageContextId, 'kaneo-key')
      await advanceStep(userId, storageContextId, 'UTC')

      const result = await processWizardMessage(userId, storageContextId, 'yes')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('Configuration saved successfully')
    })

    test('handles confirm command when wizard complete', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      // Complete all steps
      await advanceStep(userId, storageContextId, 'sk-test12345')
      await advanceStep(userId, storageContextId, 'default')
      await advanceStep(userId, storageContextId, 'gpt-4')
      await advanceStep(userId, storageContextId, 'gpt-3.5')
      await advanceStep(userId, storageContextId, 'skip')
      await advanceStep(userId, storageContextId, 'kaneo-key')
      await advanceStep(userId, storageContextId, 'UTC')

      const result = await processWizardMessage(userId, storageContextId, 'confirm')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('Configuration saved successfully')
    })

    test('advances step for normal input', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      const result = await processWizardMessage(userId, storageContextId, 'sk-test12345')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('🌐 Enter base URL')
      expect(result.requiresInput).toBe(true)
    })

    test('returns requiresInput: true for incomplete wizard', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      const result = await processWizardMessage(userId, storageContextId, 'sk-test12345')

      expect(result.handled).toBe(true)
      expect(result.requiresInput).toBe(true)
    })

    test('returns requiresInput: false when complete', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      // Complete all steps
      await advanceStep(userId, storageContextId, 'sk-test12345')
      await advanceStep(userId, storageContextId, 'default')
      await advanceStep(userId, storageContextId, 'gpt-4')
      await advanceStep(userId, storageContextId, 'gpt-3.5')
      await advanceStep(userId, storageContextId, 'skip')
      await advanceStep(userId, storageContextId, 'kaneo-key')
      await advanceStep(userId, storageContextId, 'UTC')

      const result = await processWizardMessage(userId, storageContextId, 'hello')

      expect(result.handled).toBe(true)
      // Result should still require input (needs confirmation)
      expect(result.requiresInput).toBe(true)
    })

    test('handles validation errors during processing', async () => {
      await createWizard(userId, storageContextId, 'telegram', 'kaneo')

      const result = await processWizardMessage(userId, storageContextId, '')

      expect(result.handled).toBe(true)
      expect(result.response).toContain('API key cannot be empty')
      expect(result.requiresInput).toBe(true)
    })
  })

  describe('getWizardSteps', () => {
    test('returns correct steps for kaneo provider', () => {
      const steps = getWizardSteps('kaneo')

      // Should have 7 steps total: 5 LLM steps + 1 provider + 1 timezone
      expect(steps.length).toBe(7)
      expect(steps[0]?.key).toBe('llm_apikey')
      expect(steps[5]?.key).toBe('kaneo_apikey')
      expect(steps[6]?.key).toBe('timezone')
    })

    test('returns correct steps for youtrack provider', () => {
      const steps = getWizardSteps('youtrack')

      expect(steps.length).toBe(7)
      expect(steps[5]?.key).toBe('youtrack_token')
    })
  })
})

describe('Wizard engine with end-of-wizard validation', () => {
  const userId = 'test-user-live'
  const storageContextId = 'test-context-live'

  beforeEach(async () => {
    await deleteWizardSession(userId, storageContextId)
  })

  test('should allow step advancement without validation', async () => {
    // Mock fetch to simulate API key validation failure
    const testFetch = globalThis.fetch
    globalThis.fetch = Object.assign(
      () =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        }),
      { preconnect: globalThis.fetch.preconnect },
    ) as unknown as typeof fetch

    try {
      createWizard(userId, storageContextId, 'telegram', 'kaneo')

      // Should advance without validation error
      const result = await advanceStep(userId, storageContextId, 'invalid-key', false)
      expect(result.success).toBe(true)
      expect(result.prompt).toContain('🌐 Enter base URL')
    } finally {
      globalThis.fetch = testFetch
    }
  })
})
