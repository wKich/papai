import { beforeEach, describe, expect, test } from 'bun:test'

import { handleConfigEditorCallback, handleWizardCallback } from '../../../src/chat/discord/handlers.js'
import { createEditorSession, deleteEditorSession } from '../../../src/config-editor/index.js'
import { createWizardSession, deleteWizardSession } from '../../../src/wizard/state.js'
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
    sends: Array<{ content: string; components?: unknown[] }>
    channel: {
      id: string
      type: number
      send: (arg: { content?: string; components?: unknown[] }) => Promise<{ id: string; edit: () => Promise<void> }>
      sendTyping: () => Promise<void>
    }
  } {
    const sends: Array<{ content: string; components?: unknown[] }> = []

    return {
      sends,
      channel: {
        id: 'c1',
        type: 0,
        send: (arg: {
          content?: string
          components?: unknown[]
        }): Promise<{ id: string; edit: () => Promise<void> }> => {
          sends.push({ content: arg.content ?? '', components: arg.components })
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

    test('sends response when there is an active editor session', async () => {
      const { channel, sends } = makeChannel()

      createEditorSession({ userId: configUserId, storageContextId: configContextId, editingKey: 'llm_apikey' })
      await handleConfigEditorCallback(configUserId, configContextId, 'cfg:back', channel)

      expect(sends).toHaveLength(1)
      expect(sends[0]?.content).toContain('Configuration')
    })

    test('returns early for unknown callback data', async () => {
      const { channel, sends } = makeChannel()

      createEditorSession({ userId: configUserId, storageContextId: configContextId, editingKey: 'llm_apikey' })
      await handleConfigEditorCallback(configUserId, configContextId, 'cfg:unknown:action', channel)

      expect(sends).toHaveLength(0)
    })
  })

  describe('handleWizardCallback', () => {
    test('returns early when no active wizard', async () => {
      const { channel, sends } = makeChannel()

      await handleWizardCallback(wizardUserId, wizardContextId, 'wizard_confirm', channel)

      expect(sends).toHaveLength(0)
    })

    test('handles wizard_cancel', async () => {
      const { channel, sends } = makeChannel()

      createWizardSession({
        userId: wizardUserId,
        storageContextId: wizardContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })
      await handleWizardCallback(wizardUserId, wizardContextId, 'wizard_cancel', channel)

      expect(sends).toHaveLength(1)
      expect(sends[0]?.content).toContain('cancelled')
    })

    test('handles wizard_restart', async () => {
      const { channel, sends } = makeChannel()

      createWizardSession({
        userId: wizardUserId,
        storageContextId: wizardContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })
      await handleWizardCallback(wizardUserId, wizardContextId, 'wizard_restart', channel)

      expect(sends).toHaveLength(1)
      expect(sends[0]?.content).toContain('Restarting')
    })

    test('handles wizard_edit', async () => {
      const { channel, sends } = makeChannel()

      createWizardSession({
        userId: wizardUserId,
        storageContextId: wizardContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })
      await handleWizardCallback(wizardUserId, wizardContextId, 'wizard_edit', channel)

      expect(sends).toHaveLength(1)
      expect(sends[0]?.content).toContain('Editing configuration')
    })

    test('handles unknown callback data', async () => {
      const { channel, sends } = makeChannel()

      createWizardSession({
        userId: wizardUserId,
        storageContextId: wizardContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })
      await handleWizardCallback(wizardUserId, wizardContextId, 'wizard_unknown', channel)

      expect(sends).toHaveLength(0)
    })
  })
})
