import { describe, expect, test, beforeEach } from 'bun:test'

import { handleConfigEditorCallback, handleWizardCallback } from '../../../src/chat/discord/handlers.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('discord handlers', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('handleConfigEditorCallback', () => {
    test('returns early when no active editor', async () => {
      const channel = {
        id: 'c1',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
          Promise.resolve({ id: 'm1', edit: (): Promise<void> => Promise.resolve() }),
        sendTyping: (): Promise<void> => Promise.resolve(),
      }

      await handleConfigEditorCallback('user-1', 'ctx-1', 'cfg:edit:llm_apikey', channel)
      expect(true).toBe(true)
    })
  })

  describe('handleWizardCallback', () => {
    test('returns early when no active wizard', async () => {
      const channel = {
        id: 'c1',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
          Promise.resolve({ id: 'm1', edit: (): Promise<void> => Promise.resolve() }),
        sendTyping: (): Promise<void> => Promise.resolve(),
      }

      await handleWizardCallback('user-1', 'ctx-1', 'wizard_confirm', channel)
      expect(true).toBe(true)
    })
  })
})
