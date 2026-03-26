import { describe, test, expect } from 'bun:test'

import { extractReplyId } from '../../../src/chat/mattermost/index.js'

describe('Mattermost Reply Chain', () => {
  test('should extract replyToMessageId from parent_id', () => {
    expect(extractReplyId('parent456', '')).toBe('parent456')
  })

  test('should extract replyToMessageId from root_id when parent_id missing', () => {
    expect(extractReplyId(undefined, 'root789')).toBe('root789')
  })

  test('should have undefined replyToMessageId for standalone post', () => {
    expect(extractReplyId(undefined, undefined)).toBeUndefined()
  })

  test('should ignore empty string parent_id and fall back to root_id', () => {
    expect(extractReplyId('', 'root789')).toBe('root789')
  })

  test('should return undefined when both are empty strings', () => {
    expect(extractReplyId('', '')).toBeUndefined()
  })

  test('should prefer parent_id over root_id when both present', () => {
    expect(extractReplyId('parent456', 'root123')).toBe('parent456')
  })
})

describe('Mattermost Reply Context', () => {
  test('should build threadId from root_id', () => {
    const post = {
      id: 'reply123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'Reply message',
      parent_id: 'parent456',
      root_id: 'root789',
    }

    const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
    const threadId = post.root_id === '' ? replyToMessageId : post.root_id

    expect(replyToMessageId).toBe('parent456')
    expect(threadId).toBe('root789')
  })

  test('should use root_id as threadId when available', () => {
    const post = { root_id: 'root123', parent_id: '' }
    const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
    const threadId = post.root_id === '' ? replyToMessageId : post.root_id

    expect(threadId).toBe('root123')
  })

  test('should fall back to replyToMessageId as threadId', () => {
    const post = { root_id: '', parent_id: 'parent456' }
    const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
    const threadId = post.root_id === '' ? replyToMessageId : post.root_id

    expect(threadId).toBe('parent456')
  })
})
