import { describe, expect, mock, test, beforeEach, afterEach } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import { checkAuthorizationExtended, getThreadScopedStorageContextId } from '../src/auth.js'
import { setupBot, type BotDeps } from '../src/bot.js'
import type { IncomingFile, IncomingInteraction, IncomingMessage, ReplyFn } from '../src/chat/types.js'
import { setConfig } from '../src/config.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { groupAdminObservations, knownGroupContexts } from '../src/db/schema.js'
import { getIncomingFiles } from '../src/file-relay.js'
import { addGroupMember } from '../src/groups.js'
import { addUser, isAuthorized, removeUser } from '../src/users.js'
import {
  createDmMessage,
  createGroupMessage,
  createMockChatForBot,
  createMockReply,
  mockLogger,
  setupTestDb,
} from './utils/test-helpers.js'

// Mock enqueueMessage to process synchronously for tests
void mock.module('../src/message-queue/index.js', () => ({
  enqueueMessage: (
    item: {
      text: string
      userId: string
      username: string | null
      storageContextId: string
      contextType: 'dm' | 'group'
      files: readonly IncomingFile[]
    },
    reply: ReplyFn,
    handler: (coalesced: {
      text: string
      userId: string
      username: string | null
      storageContextId: string
      files: readonly IncomingFile[]
      reply: ReplyFn
    }) => Promise<void>,
  ): void => {
    // Execute handler synchronously for tests
    void handler({
      text: item.text,
      userId: item.userId,
      username: item.username,
      storageContextId: item.storageContextId,
      files: item.files,
      reply,
    })
  },
  flushOnShutdown: (): Promise<void> => Promise.resolve(),
}))

describe('Authorization Logic', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('Bot Admin Authorization', () => {
    test('Bot admin in DM → allowed with isBotAdmin, storageContextId=userId', () => {
      addUser('admin-1', 'system', 'admin')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'admin-1', 'dm', undefined, false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'admin-1',
        configContextId: 'admin-1',
      })
    })

    test('Bot admin in group → allowed with isBotAdmin, storageContextId=groupId', () => {
      addUser('admin-1', 'system', 'admin')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', undefined, false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'group-1',
        configContextId: 'group-1',
      })
    })

    test('Bot admin who is also platform admin → isGroupAdmin=true', () => {
      addUser('admin-1', 'system', 'admin')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', undefined, true)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: true,
        storageContextId: 'group-1',
        configContextId: 'group-1',
      })
    })
  })

  describe('Group Member Authorization', () => {
    test('Group member → allowed, not bot admin, storageContextId=groupId', () => {
      addGroupMember('group-1', 'member-1', 'system')

      const result = checkAuthorizationExtended('member-1', null, 'group-1', 'group', undefined, false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'group-1',
        configContextId: 'group-1',
      })
    })

    test('Group member who is platform admin → isGroupAdmin=true', () => {
      addGroupMember('group-1', 'member-1', 'system')

      const result = checkAuthorizationExtended('member-1', null, 'group-1', 'group', undefined, true)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: true,
        storageContextId: 'group-1',
        configContextId: 'group-1',
      })
    })

    test('Non-member in group → not allowed', () => {
      const result = checkAuthorizationExtended('stranger-1', null, 'group-1', 'group', undefined, false)
      expect(result).toEqual({
        allowed: false,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'group-1',
        configContextId: 'group-1',
      })
    })
  })

  describe('DM User Resolution by Username', () => {
    test('DM user resolved by username → allowed, storageContextId=userId', () => {
      addUser('placeholder-id', 'system', 'alice')

      const result = checkAuthorizationExtended('real-alice-id', 'alice', 'real-alice-id', 'dm', undefined, false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'real-alice-id',
        configContextId: 'real-alice-id',
      })
    })

    test('DM user with unmatched username → not allowed', () => {
      const result = checkAuthorizationExtended('unknown-id', 'bob', 'unknown-id', 'dm', undefined, false)
      expect(result).toEqual({
        allowed: false,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'unknown-id',
        configContextId: 'unknown-id',
      })
    })
  })

  describe('Priority: Bot Admin Wins Over Group Check', () => {
    test('User who is BOTH bot admin AND group member → returns bot admin result (isBotAdmin=true)', () => {
      addUser('admin-1', 'system', 'admin')
      addGroupMember('group-1', 'admin-1', 'system')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', undefined, false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'group-1',
        configContextId: 'group-1',
      })
    })
  })
})

describe('Demo Mode Auto-Provision', () => {
  const DEMO_USER_ID = 'demo-user-1'
  const DEMO_USERNAME = 'demouser'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    delete process.env['DEMO_MODE']
  })

  test('demo mode: unknown DM user is auto-added with non-admin auth', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended(DEMO_USER_ID, DEMO_USERNAME, DEMO_USER_ID, 'dm', undefined, false)
    expect(result).toEqual({
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: DEMO_USER_ID,
      configContextId: DEMO_USER_ID,
    })
    expect(isAuthorized(DEMO_USER_ID)).toBe(true)
  })

  test('demo mode: demo user stays non-admin on subsequent messages', () => {
    process.env['DEMO_MODE'] = 'true'
    // First message — auto-add
    checkAuthorizationExtended(DEMO_USER_ID, DEMO_USERNAME, DEMO_USER_ID, 'dm', undefined, false)
    // Second message — user already authorized
    const result = checkAuthorizationExtended(DEMO_USER_ID, DEMO_USERNAME, DEMO_USER_ID, 'dm', undefined, false)
    expect(result).toEqual({
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: DEMO_USER_ID,
      configContextId: DEMO_USER_ID,
    })
  })

  test('demo mode: unknown DM user without username is auto-added', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended(DEMO_USER_ID, null, DEMO_USER_ID, 'dm', undefined, false)
    expect(result.allowed).toBe(true)
    expect(result.isBotAdmin).toBe(false)
    expect(isAuthorized(DEMO_USER_ID)).toBe(true)
  })

  test('demo mode: manually-added user retains bot admin auth', () => {
    process.env['DEMO_MODE'] = 'true'
    addUser('manual-user', 'admin', 'manualuser')
    const result = checkAuthorizationExtended('manual-user', 'manualuser', 'manual-user', 'dm', undefined, false)
    expect(result.isBotAdmin).toBe(true)
  })

  test('demo mode: group messages from unknown users are NOT auto-added', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended('stranger-1', null, 'group-1', 'group', undefined, false)
    expect(result.allowed).toBe(false)
  })

  test('demo mode off: unknown DM user is NOT auto-added', () => {
    const result = checkAuthorizationExtended('stranger-1', 'stranger', 'stranger-1', 'dm', undefined, false)
    expect(result.allowed).toBe(false)
  })
})

// Setup user config to bypass wizard auto-start
function setupUserConfig(userId: string): void {
  setConfig(userId, 'llm_apikey', 'sk-test1234')
  setConfig(userId, 'llm_baseurl', 'https://api.test.com')
  setConfig(userId, 'main_model', 'gpt-4')
  setConfig(userId, 'small_model', 'gpt-4')
  setConfig(userId, 'kaneo_apikey', 'test-kaneo-key')
  setConfig(userId, 'timezone', 'UTC')
}

const ADMIN_ID = 'admin-bot-auth'

describe('Bot Authorization Gate (setupBot)', () => {
  // Track processMessage calls
  let processMessageCallCount = 0
  let lastProcessedStorageId: string | null = null

  let getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null

  beforeEach(async () => {
    // Reset mutable state to defaults
    processMessageCallCount = 0
    lastProcessedStorageId = null

    // Register mocks
    mockLogger()

    // Setup test database with migrations
    await setupTestDb()

    const botDeps: BotDeps = {
      processMessage: (_reply: ReplyFn, storageContextId: string, _chatUserId: string): Promise<void> => {
        processMessageCallCount++
        lastProcessedStorageId = storageContextId
        return Promise.resolve()
      },
    }

    const { provider: mockChat, getMessageHandler: getHandler } = createMockChatForBot()
    getMessageHandler = getHandler

    setupBot(mockChat, ADMIN_ID, botDeps)
  })

  describe('Unauthorized user — silent drop', () => {
    test('does not call processMessage for unauthorized user', async () => {
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      await messageHandler!(createDmMessage('unknown-user', 'hello'), reply)
      expect(processMessageCallCount).toBe(0)
    })

    test('does not call reply.text for unauthorized user', async () => {
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()
      const { reply, textCalls } = createMockReply()
      await messageHandler!(createDmMessage('unknown-user', 'hello'), reply)
      expect(textCalls).toHaveLength(0)
    })
  })

  describe('Authorized user — message processed', () => {
    test('calls processMessage for authorized user', async () => {
      addUser('auth-user', ADMIN_ID)
      setupUserConfig('auth-user')
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      await messageHandler!(createDmMessage('auth-user', 'hello'), reply)
      expect(processMessageCallCount).toBe(1)
      expect(lastProcessedStorageId).toBe('auth-user')
    })
  })

  test('records known group and admin observations before normal message handling', async () => {
    addUser('group-admin', ADMIN_ID)
    setupUserConfig('group-admin')

    const messageHandler = getMessageHandler()
    expect(messageHandler).not.toBeNull()

    const groupMessage = createGroupMessage('group-admin', '@bot status', true, 'group-ops')
    groupMessage.contextName = 'Operations'
    groupMessage.contextParentName = 'Platform'
    groupMessage.threadId = 'thread-1'

    const { reply } = createMockReply()
    await messageHandler!(groupMessage, reply)

    const db = getDrizzleDb()
    const knownGroup = db.select().from(knownGroupContexts).where(eq(knownGroupContexts.contextId, 'group-ops')).get()
    const adminObservation = db
      .select()
      .from(groupAdminObservations)
      .where(and(eq(groupAdminObservations.contextId, 'group-ops'), eq(groupAdminObservations.userId, 'group-admin')))
      .get()

    expect(knownGroup?.displayName).toBe('Operations')
    expect(knownGroup?.parentName).toBe('Platform')
    expect(adminObservation?.isAdmin).toBe(true)
  })

  test('setupBot registers chat interaction handler when supported', () => {
    addUser('auth-user', ADMIN_ID)
    setupUserConfig('auth-user')

    const {
      provider: mockChat,
      getMessageHandler: getRegisteredMessageHandler,
      getInteractionHandler,
    } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, {
      processMessage: (): Promise<void> => Promise.resolve(),
    })

    expect(getRegisteredMessageHandler()).not.toBeNull()
    expect(getInteractionHandler()).not.toBeNull()
  })

  test('interaction handler replies with error message when routeInteraction throws', async () => {
    // Import the real module first to restore later
    const { routeInteraction: realRouteInteraction } = await import('../src/chat/interaction-router.js')

    // Mock routeInteraction to throw an error
    void mock.module('../src/chat/interaction-router.js', () => ({
      routeInteraction: (): Promise<boolean> => {
        throw new Error('Simulated routing failure')
      },
    }))

    addUser('auth-user', ADMIN_ID)
    setupUserConfig('auth-user')

    const { provider: mockChat, getInteractionHandler } = createMockChatForBot()
    setupBot(mockChat, ADMIN_ID, {
      processMessage: (): Promise<void> => Promise.resolve(),
    })

    const interactionHandler = getInteractionHandler()
    expect(interactionHandler).not.toBeNull()

    const { reply, textCalls } = createMockReply()
    const interaction: IncomingInteraction = {
      kind: 'button',
      user: { id: 'auth-user', username: 'authuser', isAdmin: false },
      contextId: 'auth-user',
      contextType: 'dm',
      storageContextId: 'auth-user',
      callbackData: 'wizard_confirm',
    }

    await interactionHandler!(interaction, reply)

    // Should show user-visible error when routeInteraction fails
    expect(textCalls.length).toBeGreaterThan(0)
    expect(textCalls[0]).toContain('Something went wrong')

    // Restore the real module to prevent mock pollution
    void mock.module('../src/chat/interaction-router.js', () => ({
      routeInteraction: realRouteInteraction,
    }))
  })

  describe('Username resolution on first message', () => {
    test('resolves username to real ID on first message', async () => {
      // Add user by username (placeholder ID, like /user add @newuser)
      addUser('placeholder-uuid', ADMIN_ID, 'newuser')
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      // First message from real user ID with that username
      const msg = createDmMessage('real-555', 'hello', 'newuser')
      setupUserConfig('real-555')
      await messageHandler!(msg, reply)
      expect(processMessageCallCount).toBe(1)
      expect(isAuthorized('real-555')).toBe(true)
    })

    test('subsequent messages from resolved user pass authorization', async () => {
      addUser('placeholder-uuid-2', ADMIN_ID, 'resolveduser')
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()
      const { reply: reply1 } = createMockReply()
      // First message - resolves username
      const msg1 = createDmMessage('real-666', 'hello', 'resolveduser')
      setupUserConfig('real-666')
      await messageHandler!(msg1, reply1)
      expect(processMessageCallCount).toBe(1)

      // Second message - should use real ID directly
      const { reply: reply2 } = createMockReply()
      const msg2 = createDmMessage('real-666', 'hello', 'resolveduser')
      await messageHandler!(msg2, reply2)
      expect(processMessageCallCount).toBe(2)
    })
  })

  describe('Access revoked during session', () => {
    test('drops message after user is removed', async () => {
      addUser('removable-user', ADMIN_ID)
      setupUserConfig('removable-user')
      const messageHandler = getMessageHandler()
      expect(messageHandler).not.toBeNull()

      // First message — authorized
      const { reply: reply1 } = createMockReply()
      await messageHandler!(createDmMessage('removable-user', 'hello'), reply1)
      expect(processMessageCallCount).toBe(1)

      // Remove user
      removeUser('removable-user')

      // Second message — should be dropped
      const { reply: reply2, textCalls } = createMockReply()
      await messageHandler!(createDmMessage('removable-user', 'hello'), reply2)
      expect(processMessageCallCount).toBe(1)
      expect(textCalls).toHaveLength(0)
    })
  })
})

describe('Demo Mode — wizard bypass (setupBot)', () => {
  let processMessageCallCount = 0
  let lastProcessedStorageId: string | null = null

  let getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null

  beforeEach(async () => {
    // Reset mutable state to defaults
    processMessageCallCount = 0
    lastProcessedStorageId = null

    // Register mocks
    mockLogger()

    await setupTestDb()

    const botDeps: BotDeps = {
      processMessage: (_reply: ReplyFn, storageContextId: string, _chatUserId: string): Promise<void> => {
        processMessageCallCount++
        lastProcessedStorageId = storageContextId
        return Promise.resolve()
      },
    }

    const { provider: mockChat, getMessageHandler: getHandler } = createMockChatForBot()
    getMessageHandler = getHandler

    setupBot(mockChat, ADMIN_ID, botDeps)
  })

  afterEach(() => {
    delete process.env['DEMO_MODE']
  })

  test('demo user message reaches processMessage instead of wizard', async () => {
    process.env['DEMO_MODE'] = 'true'
    // Add as demo user (no config — normally triggers wizard)
    addUser('demo-bypass-1', 'demo-auto', 'demouser')

    const messageHandler = getMessageHandler()
    const { reply } = createMockReply()
    await messageHandler!(createDmMessage('demo-bypass-1', 'hello', 'demouser'), reply)

    // Should reach processMessage, not be intercepted by wizard
    expect(processMessageCallCount).toBe(1)
    expect(lastProcessedStorageId).toBe('demo-bypass-1')
  })
})

describe('File relay integration (setupBot)', () => {
  const RELAY_ADMIN = 'relay-admin'
  let capturedStorageId: string | null = null
  let filesAtProcessingTime: readonly IncomingFile[] = []
  let getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null

  function makeFile(overrides: Partial<IncomingFile> = {}): IncomingFile {
    return {
      fileId: 'f1',
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      size: 1000,
      content: Buffer.from('data'),
      ...overrides,
    }
  }

  beforeEach(async () => {
    capturedStorageId = null
    filesAtProcessingTime = []
    mockLogger()
    await setupTestDb()

    const botDeps: BotDeps = {
      processMessage: (_reply: ReplyFn, storageContextId: string, _chatUserId: string): Promise<void> => {
        capturedStorageId = storageContextId
        // Capture files at processing time (before they're cleared in finally block)
        filesAtProcessingTime = getIncomingFiles(storageContextId)
        return Promise.resolve()
      },
    }

    const { provider: mockChat, getMessageHandler: getHandler } = createMockChatForBot()
    getMessageHandler = getHandler
    setupBot(mockChat, RELAY_ADMIN, botDeps)
  })

  test('stores files in relay keyed by storageContextId for authorized user', async () => {
    addUser('relay-user', RELAY_ADMIN)
    setupUserConfig('relay-user')
    const file = makeFile()
    const msg: IncomingMessage = { ...createDmMessage('relay-user'), files: [file] }
    const { reply } = createMockReply()

    await getMessageHandler()!(msg, reply)

    expect(capturedStorageId).toBe('relay-user')
    // Files are cleared after processing, so check what was captured during processing
    expect(filesAtProcessingTime).toHaveLength(1)
    expect(filesAtProcessingTime[0]?.fileId).toBe('f1')
  })

  test('clears relay when message has no files', async () => {
    addUser('relay-user2', RELAY_ADMIN)
    setupUserConfig('relay-user2')
    // Pre-populate relay
    const { storeIncomingFiles } = await import('../src/file-relay.js')
    storeIncomingFiles('relay-user2', [makeFile()])

    const msg: IncomingMessage = { ...createDmMessage('relay-user2') }
    const { reply } = createMockReply()
    await getMessageHandler()!(msg, reply)

    expect(getIncomingFiles('relay-user2')).toEqual([])
  })

  test('does not store files for unauthorized user', async () => {
    const file = makeFile({ fileId: 'secret' })
    const msg: IncomingMessage = { ...createDmMessage('unauth-user'), files: [file] }
    const { reply } = createMockReply()

    await getMessageHandler()!(msg, reply)

    expect(getIncomingFiles('unauth-user')).toEqual([])
  })
})

describe('getThreadScopedStorageContextId', () => {
  test('should return userId for DM context', () => {
    const result = getThreadScopedStorageContextId('user123', 'dm', undefined)
    expect(result).toBe('user123')
  })

  test('should return groupId for main chat (no thread)', () => {
    const result = getThreadScopedStorageContextId('group456', 'group', undefined)
    expect(result).toBe('group456')
  })

  test('should return groupId:threadId for thread', () => {
    const result = getThreadScopedStorageContextId('group456', 'group', 'thread789')
    expect(result).toBe('group456:thread789')
  })
})
