import { beforeEach, describe, expect, test } from 'bun:test'

import { routeInteraction } from '../../src/chat/interaction-router.js'
import type { AuthorizationResult, IncomingInteraction, ReplyFn } from '../../src/chat/types.js'
import { deleteWizardSession } from '../../src/wizard/state.js'

const interaction: IncomingInteraction = {
  kind: 'button',
  user: { id: 'user-1', username: 'alice', isAdmin: false },
  contextId: 'ctx-1',
  contextType: 'dm',
  storageContextId: 'ctx-1',
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

const createMockAuth = (allowed: boolean): AuthorizationResult => ({
  allowed,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: 'ctx-1',
})

describe('routeInteraction', () => {
  beforeEach(() => {
    deleteWizardSession(interaction.user.id, interaction.contextId)
  })

  test('routes cfg callbacks through the config interaction dependency', async () => {
    const calls: string[] = []
    const handled = await routeInteraction(interaction, reply, createMockAuth(true), {
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
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'wizard_confirm' },
      reply,
      createMockAuth(true),
      {
        handleConfigInteraction: () => Promise.resolve(false),
        handleWizardInteraction: () => {
          calls.push('wizard')
          return Promise.resolve(true)
        },
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual(['wizard'])
  })

  test('returns false for unrecognized callback prefixes', async () => {
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'unknown:action' },
      reply,
      createMockAuth(true),
      {
        handleConfigInteraction: () => Promise.resolve(false),
        handleWizardInteraction: () => Promise.resolve(false),
      },
    )

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
      createMockAuth(true),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['No active setup session. Type /setup to start.'])
  })

  test('blocks unauthorized users with unauthorized message', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'cfg:edit:timezone' },
      {
        ...reply,
        text: (content: string): Promise<void> => {
          replies.push(content)
          return Promise.resolve()
        },
      },
      createMockAuth(false),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['You are not authorized to use this bot.'])
  })

  test('blocks wizard callbacks for unauthorized users', async () => {
    const replies: string[] = []
    const handled = await routeInteraction(
      { ...interaction, callbackData: 'wizard_confirm' },
      {
        ...reply,
        text: (content: string): Promise<void> => {
          replies.push(content)
          return Promise.resolve()
        },
      },
      createMockAuth(false),
    )

    expect(handled).toBe(true)
    expect(replies).toEqual(['You are not authorized to use this bot.'])
  })
})
