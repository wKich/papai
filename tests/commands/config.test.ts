import { beforeEach, describe, expect, test } from 'bun:test'

import type { AuthorizationResult, ChatProvider, CommandHandler } from '../../src/chat/types.js'
import { registerConfigCommand } from '../../src/commands/config.js'
import { setConfig } from '../../src/config.js'
import { clearUserCache } from '../utils/test-cache.js'
import { createDmMessage, createMockReply, mockDrizzle, mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Mock logger at top of file
mockLogger()

// Mock getDrizzleDb BEFORE importing source modules
mockDrizzle()

const USER_ID = 'config-test-user'

function createAuth(userId: string, allowed: boolean): AuthorizationResult {
  return {
    allowed,
    isBotAdmin: allowed,
    isGroupAdmin: false,
    storageContextId: userId,
  }
}

describe('/config Command', () => {
  let configHandler: CommandHandler | null

  beforeEach(async () => {
    await setupTestDb()
    clearUserCache(USER_ID)

    configHandler = null
    const mockChat: ChatProvider = {
      name: 'mock',
      registerCommand: (_name: string, handler: CommandHandler): void => {
        configHandler = handler
      },
      onMessage: (): void => {},
      sendMessage: (): Promise<void> => Promise.resolve(),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }
    registerConfigCommand(mockChat, (_userId: string) => true)
  })

  test('shows all config keys with values and masked secrets', async () => {
    setConfig(USER_ID, 'llm_apikey', 'sk-abc1234')
    expect(configHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await configHandler!(createDmMessage(USER_ID), reply, createAuth(USER_ID, true))
    expect(textCalls[0]).toContain('llm_apikey: ****1234')
    expect(textCalls[0]).toContain('main_model: (not set)')
  })

  test('shows unset placeholder for unconfigured keys', async () => {
    expect(configHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await configHandler!(createDmMessage(USER_ID), reply, createAuth(USER_ID, true))
    const output = textCalls[0] ?? ''
    expect(output.length).toBeGreaterThan(0)
    const lines = output.split('\n').filter((line) => line.trim().length > 0)
    expect(lines.length).toBeGreaterThan(0)
    // Every non-empty line should show "(not set)" since no keys are configured
    expect(lines.every((line) => line.includes('(not set)'))).toBe(true)
  })

  test('rejects unauthorized user silently', async () => {
    expect(configHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await configHandler!(createDmMessage('unauthorized-user'), reply, createAuth('unauthorized-user', false))
    expect(textCalls).toHaveLength(0)
  })
})
