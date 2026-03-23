import { beforeEach, describe, expect, test } from 'bun:test'

import type { AuthorizationResult, ChatProvider, CommandHandler } from '../../src/chat/types.js'
import { registerSetCommand } from '../../src/commands/set.js'
import { getConfig } from '../../src/config.js'
import { clearUserCache } from '../utils/test-cache.js'
import { createDmMessage, createMockReply, mockDrizzle, mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Mock logger at top of file
mockLogger()

// Mock getDrizzleDb BEFORE importing source modules
mockDrizzle()

const USER_ID = 'set-test-user'

function createAuth(userId: string, allowed: boolean): AuthorizationResult {
  return {
    allowed,
    isBotAdmin: allowed,
    isGroupAdmin: false,
    storageContextId: userId,
  }
}

describe('/set Command', () => {
  let setHandler: CommandHandler | null

  beforeEach(async () => {
    await setupTestDb()
    clearUserCache(USER_ID)

    setHandler = null
    const mockChat: ChatProvider = {
      name: 'mock',
      registerCommand: (_name: string, handler: CommandHandler): void => {
        setHandler = handler
      },
      onMessage: (): void => {},
      sendMessage: (): Promise<void> => Promise.resolve(),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }
    registerSetCommand(mockChat, (_userId: string) => true)
  })

  test('stores valid config key and confirms', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(createDmMessage(USER_ID, 'llm_apikey sk-test1234'), reply, createAuth(USER_ID, true))
    expect(textCalls[0]).toBe('Set llm_apikey successfully.')
    expect(getConfig(USER_ID, 'llm_apikey')).toBe('sk-test1234')
  })

  test('stores main_model and confirms', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(createDmMessage(USER_ID, 'main_model gpt-4o'), reply, createAuth(USER_ID, true))
    expect(textCalls[0]).toBe('Set main_model successfully.')
    expect(getConfig(USER_ID, 'main_model')).toBe('gpt-4o')
  })

  test('stores llm_baseurl and confirms', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(
      createDmMessage(USER_ID, 'llm_baseurl https://api.openai.com/v1'),
      reply,
      createAuth(USER_ID, true),
    )
    expect(textCalls[0]).toBe('Set llm_baseurl successfully.')
    expect(getConfig(USER_ID, 'llm_baseurl')).toBe('https://api.openai.com/v1')
  })

  test('rejects unknown key', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(createDmMessage(USER_ID, 'invalid_key value'), reply, createAuth(USER_ID, true))
    expect(textCalls[0]).toContain('Unknown key')
    expect(getConfig(USER_ID, 'llm_apikey')).toBeNull()
  })

  test('shows usage when value is missing', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(createDmMessage(USER_ID, 'llm_apikey'), reply, createAuth(USER_ID, true))
    expect(textCalls[0]).toContain('Usage: /set')
  })

  test('rejects unauthorized user silently', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(
      createDmMessage('unauthorized-user', 'main_model gpt-4'),
      reply,
      createAuth('unauthorized-user', false),
    )
    expect(textCalls).toHaveLength(0)
    expect(getConfig('unauthorized-user', 'main_model')).toBeNull()
  })

  test('stores value that contains spaces', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(
      createDmMessage(USER_ID, 'llm_baseurl https://example.com/v1 extra'),
      reply,
      createAuth(USER_ID, true),
    )
    expect(textCalls[0]).toBe('Set llm_baseurl successfully.')
    expect(getConfig(USER_ID, 'llm_baseurl')).toBe('https://example.com/v1 extra')
  })

  test('overwrites existing config value', async () => {
    expect(setHandler).not.toBeNull()
    const { reply: reply1, textCalls: textCalls1 } = createMockReply()
    await setHandler!(createDmMessage(USER_ID, 'main_model gpt-4o'), reply1, createAuth(USER_ID, true))
    expect(textCalls1[0]).toBe('Set main_model successfully.')

    const { reply: reply2, textCalls: textCalls2 } = createMockReply()
    await setHandler!(createDmMessage(USER_ID, 'main_model gpt-4o-mini'), reply2, createAuth(USER_ID, true))
    expect(textCalls2[0]).toBe('Set main_model successfully.')
    expect(getConfig(USER_ID, 'main_model')).toBe('gpt-4o-mini')
  })
})
