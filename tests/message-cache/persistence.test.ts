import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockLogger, setupTestDb, mockDrizzle } from '../utils/test-helpers.js'

// Mock logger before importing modules that use it
mockLogger()

// Setup test DB and mock drizzle before importing persistence module
mockDrizzle()

afterAll(() => {
  mock.restore()
})

import { messageMetadata } from '../../src/db/schema.js'
import {
  scheduleMessagePersistence,
  loadMessagesFromDb,
  cleanupExpiredMessages,
} from '../../src/message-cache/persistence.js'

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

describe('Message Persistence', () => {
  beforeEach(async () => {
    const db = await setupTestDb()
    // Clear table between tests
    db.delete(messageMetadata).run()
  })

  test('should persist messages to database via microtask flush', async () => {
    const now = Date.now()

    scheduleMessagePersistence({
      messageId: 'msg-1',
      contextId: 'chat-1',
      authorId: 'user-1',
      authorUsername: 'alice',
      text: 'Hello world',
      timestamp: now,
    })

    // Wait for microtask to flush
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const messages = loadMessagesFromDb('chat-1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.messageId).toBe('msg-1')
    expect(messages[0]?.text).toBe('Hello world')
    expect(messages[0]?.authorUsername).toBe('alice')
  })

  test('should batch multiple writes into single flush', async () => {
    const now = Date.now()

    scheduleMessagePersistence({
      messageId: 'msg-1',
      contextId: 'chat-1',
      authorId: 'user-1',
      text: 'First',
      timestamp: now,
    })

    scheduleMessagePersistence({
      messageId: 'msg-2',
      contextId: 'chat-1',
      authorId: 'user-2',
      text: 'Second',
      timestamp: now,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const messages = loadMessagesFromDb('chat-1')
    expect(messages).toHaveLength(2)
  })

  test('should upsert on conflict', async () => {
    const now = Date.now()

    scheduleMessagePersistence({
      messageId: 'msg-1',
      contextId: 'chat-1',
      text: 'Original',
      timestamp: now,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    scheduleMessagePersistence({
      messageId: 'msg-1',
      contextId: 'chat-1',
      text: 'Updated',
      timestamp: now,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const messages = loadMessagesFromDb('chat-1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.text).toBe('Updated')
  })

  test('should load messages filtered by contextId', async () => {
    const now = Date.now()

    scheduleMessagePersistence({
      messageId: 'msg-1',
      contextId: 'chat-1',
      text: 'In chat 1',
      timestamp: now,
    })

    scheduleMessagePersistence({
      messageId: 'msg-2',
      contextId: 'chat-2',
      text: 'In chat 2',
      timestamp: now,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const chat1Messages = loadMessagesFromDb('chat-1')
    expect(chat1Messages).toHaveLength(1)
    expect(chat1Messages[0]?.text).toBe('In chat 1')

    const chat2Messages = loadMessagesFromDb('chat-2')
    expect(chat2Messages).toHaveLength(1)
    expect(chat2Messages[0]?.text).toBe('In chat 2')
  })

  test('should not load expired messages', async () => {
    const expired = Date.now() - ONE_WEEK_MS - 1000

    scheduleMessagePersistence({
      messageId: 'msg-old',
      contextId: 'chat-1',
      text: 'Expired',
      timestamp: expired,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const messages = loadMessagesFromDb('chat-1')
    expect(messages).toHaveLength(0)
  })

  test('should cleanup expired messages', async () => {
    const expired = Date.now() - ONE_WEEK_MS - 1000

    scheduleMessagePersistence({
      messageId: 'msg-old',
      contextId: 'chat-1',
      text: 'Expired',
      timestamp: expired,
    })

    scheduleMessagePersistence({
      messageId: 'msg-new',
      contextId: 'chat-1',
      text: 'Fresh',
      timestamp: Date.now(),
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    cleanupExpiredMessages()

    const messages = loadMessagesFromDb('chat-1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.messageId).toBe('msg-new')
  })

  test('should convert optional fields to undefined on load', async () => {
    scheduleMessagePersistence({
      messageId: 'msg-minimal',
      contextId: 'chat-1',
      timestamp: Date.now(),
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const messages = loadMessagesFromDb('chat-1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.authorId).toBeUndefined()
    expect(messages[0]?.authorUsername).toBeUndefined()
    expect(messages[0]?.text).toBeUndefined()
    expect(messages[0]?.replyToMessageId).toBeUndefined()
  })
})
