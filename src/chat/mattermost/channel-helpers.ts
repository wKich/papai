import { logger } from '../../logger.js'
import { ChannelInfoSchema, ChannelMemberSchema } from './schema.js'

const log = logger.child({ scope: 'chat:mattermost:channel' })

export async function fetchChannelInfo(
  channelId: string,
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>,
): Promise<{ type: string }> {
  const data = await apiFetch('GET', `/api/v4/channels/${channelId}`, undefined)
  const parsed = ChannelInfoSchema.safeParse(data)
  if (!parsed.success) {
    log.warn({ channelId, error: parsed.error }, 'Failed to parse channel info')
    return { type: '' }
  }
  return parsed.data
}

export async function checkChannelAdmin(
  channelId: string,
  userId: string,
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>,
): Promise<boolean> {
  try {
    const data = await apiFetch('GET', `/api/v4/channels/${channelId}/members/${userId}`, undefined)
    const parsed = ChannelMemberSchema.safeParse(data)
    if (!parsed.success) {
      log.warn({ channelId, userId, error: parsed.error }, 'Failed to parse channel member')
      return false
    }
    return parsed.data.roles.includes('channel_admin')
  } catch {
    return false
  }
}
