import { describe, expect, it } from 'bun:test'

import { checkChannelAdmin, fetchChannelInfo } from '../../../src/chat/mattermost/channel-helpers.js'

describe('channel-helpers', () => {
  describe('fetchChannelInfo', () => {
    it('should return channel type on success', async () => {
      const mockData = { type: 'D' }
      const apiFetch = (): Promise<unknown> => Promise.resolve(mockData)

      const result = await fetchChannelInfo('channel123', apiFetch)

      expect(result).toEqual({ type: 'D' })
    })

    it('should return empty type on invalid response', async () => {
      const apiFetch = (): Promise<unknown> => Promise.resolve({ invalid: true })

      const result = await fetchChannelInfo('channel123', apiFetch)

      expect(result).toEqual({ type: '' })
    })
  })

  describe('checkChannelAdmin', () => {
    it('should return true when user has channel_admin role', async () => {
      const apiFetch = (): Promise<unknown> => Promise.resolve({ roles: 'channel_admin system_user' })

      const result = await checkChannelAdmin('channel123', 'user456', apiFetch)

      expect(result).toBe(true)
    })

    it('should return false when user does not have channel_admin role', async () => {
      const apiFetch = (): Promise<unknown> => Promise.resolve({ roles: 'system_user' })

      const result = await checkChannelAdmin('channel123', 'user456', apiFetch)

      expect(result).toBe(false)
    })

    it('should return false on API error', async () => {
      const apiFetch = (): Promise<never> => Promise.reject(new Error('API Error'))

      const result = await checkChannelAdmin('channel123', 'user456', apiFetch)

      expect(result).toBe(false)
    })

    it('should return false on invalid response', async () => {
      const apiFetch = (): Promise<unknown> => Promise.resolve({ invalid: true })

      const result = await checkChannelAdmin('channel123', 'user456', apiFetch)

      expect(result).toBe(false)
    })
  })
})
