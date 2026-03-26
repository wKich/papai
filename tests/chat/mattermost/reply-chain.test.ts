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
