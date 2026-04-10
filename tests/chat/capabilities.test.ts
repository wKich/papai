import { describe, expect, test } from 'bun:test'

import {
  supportsCommandMenu,
  supportsFileReplies,
  supportsInteractiveButtons,
  supportsUserResolution,
} from '../../src/chat/capabilities.js'
import type { ChatCapability, ChatProvider } from '../../src/chat/types.js'

const interactiveChat: ChatProvider = {
  name: 'mock',
  threadCapabilities: { supportsThreads: true, canCreateThreads: false, threadScope: 'message' },
  capabilities: new Set<ChatCapability>([
    'messages.buttons',
    'interactions.callbacks',
    'messages.files',
    'users.resolve',
    'commands.menu',
  ]),
  traits: { observedGroupMessages: 'all' },
  configRequirements: [],
  registerCommand: (): void => {},
  onMessage: (): void => {},
  onInteraction: (): void => {},
  sendMessage: (): Promise<void> => Promise.resolve(),
  resolveUserId: (): Promise<string | null> => Promise.resolve('user-1'),
  setCommands: (): Promise<void> => Promise.resolve(),
  start: (): Promise<void> => Promise.resolve(),
  stop: (): Promise<void> => Promise.resolve(),
}

describe('chat capability helpers', () => {
  test('supportsInteractiveButtons requires both button rendering and callbacks', () => {
    expect(supportsInteractiveButtons(interactiveChat)).toBe(true)
    expect(
      supportsInteractiveButtons({
        ...interactiveChat,
        capabilities: new Set<ChatCapability>(['messages.buttons']),
      }),
    ).toBe(false)
  })

  test('supportsFileReplies, supportsUserResolution, and supportsCommandMenu read the capability set', () => {
    expect(supportsFileReplies(interactiveChat)).toBe(true)
    expect(supportsUserResolution(interactiveChat)).toBe(true)
    expect(supportsCommandMenu(interactiveChat)).toBe(true)
  })
})
