/**
 * Tests for config-editor chat integration
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mock } from 'bun:test'

import { mockDrizzle, mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Setup mocks
mockLogger()
mockDrizzle()

afterAll(() => {
  mock.restore()
})

// Import after mocking
import { handleConfigEditorMessage } from '../../src/chat/config-editor-integration.js'
import { deleteEditorSession, startEditor } from '../../src/config-editor/index.js'

describe('config-editor chat integration', () => {
  const userId = 'user123'
  const storageContextId = 'ctx456'

  beforeEach(async () => {
    await setupTestDb()
    deleteEditorSession(userId, storageContextId)
  })

  test('returns false when no active editor', async () => {
    const reply = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
    }

    const result = await handleConfigEditorMessage(userId, storageContextId, 'some text', reply)
    expect(result).toBe(false)
  })

  test('handles message when editor is active', async () => {
    // Start an editor session
    startEditor(userId, storageContextId, 'main_model')

    let buttonsCalled = false
    const reply = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: (): Promise<void> => {
        buttonsCalled = true
        return Promise.resolve()
      },
    }

    const result = await handleConfigEditorMessage(userId, storageContextId, 'gpt-4', reply)
    expect(result).toBe(true)
    expect(buttonsCalled).toBe(true)
  })
})
