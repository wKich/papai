/**
 * Tests for wizard-integration module
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleWizardMessage } from '../src/wizard-integration.js'
import { deleteWizardSession } from '../src/wizard/state.js'
import { mockDrizzle, mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('wizard-integration', () => {
  const userId = 'user123'
  const storageContextId = 'ctx456'

  beforeEach(async () => {
    mockLogger()
    mockDrizzle()
    await setupTestDb()
    deleteWizardSession(userId, storageContextId)
  })

  test('returns false when no active wizard', async () => {
    const reply = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
    }

    const result = await handleWizardMessage(userId, storageContextId, 'some text', reply, 'telegram')
    expect(result).toBe(false)
  })
})
