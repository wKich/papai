import { beforeEach, describe, expect, test } from 'bun:test'

import { handleConfigEditorCallback, handleWizardCallback } from '../../../src/chat/discord/handlers.js'
import { deleteEditorSession } from '../../../src/config-editor/index.js'
import { deleteWizardSession } from '../../../src/wizard/state.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('discord handlers', () => {
  const configUserId = 'discord-config-handler-user'
  const configContextId = 'discord-config-handler-context'
  const wizardUserId = 'discord-wizard-handler-user'
  const wizardContextId = 'discord-wizard-handler-context'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteEditorSession(configUserId, configContextId)
    deleteWizardSession(wizardUserId, wizardContextId)
  })

  function makeChannel(): {
    sends: string[]
    channel: {
      id: string
      type: number
      send: () => Promise<{ id: string; edit: () => Promise<void> }>
      sendTyping: () => Promise<void>
    }
  } {
    const sends: string[] = []

    return {
      sends,
      channel: {
        id: 'c1',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> => {
          sends.push(`send-${String(sends.length + 1)}`)
          return Promise.resolve({ id: 'm1', edit: (): Promise<void> => Promise.resolve() })
        },
        sendTyping: (): Promise<void> => Promise.resolve(),
      },
    }
  }

  describe('handleConfigEditorCallback', () => {
    test('returns early when no active editor', async () => {
      const { channel, sends } = makeChannel()

      await handleConfigEditorCallback(configUserId, configContextId, 'cfg:edit:llm_apikey', channel)

      expect(sends).toHaveLength(0)
    })
  })

  describe('handleWizardCallback', () => {
    test('returns early when no active wizard', async () => {
      const { channel, sends } = makeChannel()

      await handleWizardCallback(wizardUserId, wizardContextId, 'wizard_confirm', channel)

      expect(sends).toHaveLength(0)
    })
  })
})
