/**
 * Tests for wizard-integration module
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleWizardMessage } from '../src/wizard-integration.js'
import { createWizard } from '../src/wizard/engine.js'
import { deleteWizardSession } from '../src/wizard/state.js'
import { createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('wizard-integration', () => {
  const userId = 'user123'
  const storageContextId = 'ctx456'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteWizardSession(userId, storageContextId)
  })

  test('returns false when no active wizard', async () => {
    const { reply } = createMockReply()

    const result = await handleWizardMessage(userId, storageContextId, 'some text', reply, true)
    expect(result).toBe(false)
  })

  test('handleWizardMessage falls back to text when interactive buttons are disabled', async () => {
    await createWizard(userId, storageContextId, 'kaneo')
    const { reply, textCalls, buttonCalls } = createMockReply()

    const handled = await handleWizardMessage(userId, storageContextId, 'sk-test12345', reply, false)

    expect(handled).toBe(true)
    expect(textCalls.length).toBeGreaterThan(0)
    expect(buttonCalls.length).toBe(0)
  })
})
