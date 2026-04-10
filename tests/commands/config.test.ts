import { beforeEach, describe, expect, test } from 'bun:test'

import type { AuthorizationResult, CommandHandler } from '../../src/chat/types.js'
import { registerConfigCommand } from '../../src/commands/config.js'
import { setConfig } from '../../src/config.js'
import { clearUserCache } from '../utils/test-cache.js'
import {
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

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
    mockLogger()
    await setupTestDb()
    clearUserCache(USER_ID)

    const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
    registerConfigCommand(mockChat, (_userId: string) => true)
    configHandler = commandHandlers.get('config') ?? null
  })

  test('shows all config keys with values and masked secrets', async () => {
    setConfig(USER_ID, 'llm_apikey', 'sk-abc1234')
    expect(configHandler).not.toBeNull()
    const { reply, buttonCalls } = createMockReply()
    await configHandler!(createDmMessage(USER_ID), reply, createAuth(USER_ID, true))
    expect(buttonCalls[0]).toContain('****1234')
    expect(buttonCalls[0]).toContain('*(not set)*')
  })

  test('shows unset placeholder for unconfigured keys', async () => {
    expect(configHandler).not.toBeNull()
    const { reply, buttonCalls } = createMockReply()
    await configHandler!(createDmMessage(USER_ID), reply, createAuth(USER_ID, true))
    const output = buttonCalls[0] ?? ''
    expect(output.length).toBeGreaterThan(0)
    const lines = output.split('\n').filter((line) => line.trim().length > 0)
    expect(lines.length).toBeGreaterThan(0)
    // Every config line should show "(not set)" since no keys are configured
    // (exclude the hint line at the end)
    const configLines = lines.filter((line) => line.includes(':'))
    expect(configLines.every((line) => line.includes('(not set)'))).toBe(true)
  })

  test('rejects unauthorized user silently', async () => {
    expect(configHandler).not.toBeNull()
    const { reply, buttonCalls } = createMockReply()
    await configHandler!(createDmMessage('unauthorized-user'), reply, createAuth('unauthorized-user', false))
    expect(buttonCalls).toHaveLength(0)
  })
})
