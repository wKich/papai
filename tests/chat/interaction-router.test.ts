import { beforeEach, describe, expect, test } from 'bun:test'

import { routeInteraction } from '../../src/chat/interaction-router.js'
import type { IncomingInteraction, ReplyFn } from '../../src/chat/types.js'
import { handleEditorMessage } from '../../src/config-editor/handlers.js'
import { createEditorSession, deleteEditorSession } from '../../src/config-editor/state.js'
import { getConfig } from '../../src/config.js'
import { createGroupSettingsSession, deleteGroupSettingsSession } from '../../src/group-settings/state.js'
import { deleteWizardSession } from '../../src/wizard/state.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const interaction: IncomingInteraction = {
  kind: 'button',
  user: { id: 'user-1', username: 'alice', isAdmin: false },
  contextId: 'ctx-1',
  contextType: 'dm',
  callbackData: 'cfg:edit:timezone',
}

const reply: ReplyFn = {
  text: async (): Promise<void> => {},
  formatted: async (): Promise<void> => {},
  file: async (): Promise<void> => {},
  typing: (): void => {},
  redactMessage: async (): Promise<void> => {},
  buttons: async (): Promise<void> => {},
}

describe('routeInteraction', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteWizardSession(interaction.user.id, interaction.contextId)
    deleteEditorSession(interaction.user.id, interaction.contextId)
    deleteEditorSession(interaction.user.id, 'group-9')
    deleteGroupSettingsSession(interaction.user.id)
  })

  test('routes gsel callbacks through the group settings interaction dependency', async () => {
    const calls: string[] = []
    const handled = await routeInteraction({ ...interaction, callbackData: 'gsel:scope:group' }, reply, {
      handleGroupSettingsInteraction: () => {
        calls.push('gsel')
        return Promise.resolve(true)
      },
      handleConfigInteraction: () => Promise.resolve(false),
      handleWizardInteraction: () => Promise.resolve(false),
    })

    expect(handled).toBe(true)
    expect(calls).toEqual(['gsel'])
  })

  test('routes cfg callbacks through the config interaction dependency', async () => {
    const calls: string[] = []
    const handled = await routeInteraction(interaction, reply, {
      handleGroupSettingsInteraction: () => Promise.resolve(false),
      handleConfigInteraction: () => {
        calls.push('cfg')
        return Promise.resolve(true)
      },
      handleWizardInteraction: () => Promise.resolve(false),
    })

    expect(handled).toBe(true)
    expect(calls).toEqual(['cfg'])
  })

  test('routes wizard callbacks through the wizard interaction dependency', async () => {
    const calls: string[] = []
    const handled = await routeInteraction({ ...interaction, callbackData: 'wizard_confirm' }, reply, {
      handleGroupSettingsInteraction: () => Promise.resolve(false),
      handleConfigInteraction: () => Promise.resolve(false),
      handleWizardInteraction: () => {
        calls.push('wizard')
        return Promise.resolve(true)
      },
    })

    expect(handled).toBe(true)
    expect(calls).toEqual(['wizard'])
  })

  test('returns false for unrecognized callback prefixes', async () => {
    const handled = await routeInteraction({ ...interaction, callbackData: 'unknown:action' }, reply, {
      handleGroupSettingsInteraction: () => Promise.resolve(false),
      handleConfigInteraction: () => Promise.resolve(false),
      handleWizardInteraction: () => Promise.resolve(false),
    })

    expect(handled).toBe(false)
  })

  test('replies when wizard edit is clicked without an active session', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'wizard_edit' },
      {
        ...reply,
        text: (content: string): Promise<void> => {
          replies.push(content)
          return Promise.resolve()
        },
      },
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['No active setup session. Type /setup to start.'])
  })

  test('uses the active group target for cfg callbacks received in DM', async () => {
    createGroupSettingsSession({
      userId: interaction.user.id,
      command: 'config',
      stage: 'active',
      targetContextId: 'group-9',
    })
    createEditorSession({
      userId: interaction.user.id,
      storageContextId: 'group-9',
      editingKey: 'timezone',
    })

    const buttonReplies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'cfg:cancel' },
      {
        ...reply,
        buttons: (content: string): Promise<void> => {
          buttonReplies.push(content)
          return Promise.resolve()
        },
      },
    )

    expect(handled).toBe(true)
    expect(buttonReplies[0]).toContain('Changes cancelled')
  })

  test('saves edited config into the selected group context instead of the DM user context', async () => {
    createGroupSettingsSession({
      userId: interaction.user.id,
      command: 'config',
      stage: 'active',
      targetContextId: 'group-9',
    })
    createEditorSession({
      userId: interaction.user.id,
      storageContextId: 'group-9',
      editingKey: 'timezone',
    })
    handleEditorMessage(interaction.user.id, 'group-9', 'Europe/Berlin')

    await routeInteraction({ ...interaction, callbackData: 'cfg:save:timezone' }, reply)

    expect(getConfig('group-9', 'timezone')).toBe('Europe/Berlin')
    expect(getConfig(interaction.user.id, 'timezone')).toBeNull()
  })
})
