import { describe, expect, it } from 'bun:test'

import {
  mattermostCapabilities,
  mattermostConfigRequirements,
  mattermostTraits,
} from '../../../src/chat/mattermost/metadata.js'

describe('mattermost metadata', () => {
  it('should export required config requirements', () => {
    expect(mattermostConfigRequirements.length).toBe(2)
    expect(mattermostConfigRequirements[0]?.key).toBe('MATTERMOST_URL')
    expect(mattermostConfigRequirements[1]?.key).toBe('MATTERMOST_BOT_TOKEN')
  })

  it('should export capabilities as ReadonlySet', () => {
    expect(mattermostCapabilities.has('users.resolve')).toBe(true)
  })

  it('should export traits', () => {
    expect(mattermostTraits.observedGroupMessages).toBe('all')
    expect(mattermostTraits.maxMessageLength).toBe(16383)
  })
})
