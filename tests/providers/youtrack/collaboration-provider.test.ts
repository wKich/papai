import { describe, expect, test } from 'bun:test'

import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import { YouTrackCollaborationProvider } from '../../../src/providers/youtrack/collaboration-provider.js'
import { YouTrackProvider } from '../../../src/providers/youtrack/index.js'

const createConfig = (): YouTrackConfig => ({
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
})

describe('YouTrackCollaborationProvider', () => {
  test('is extended by YouTrackProvider', () => {
    const provider = new YouTrackProvider(createConfig())
    expect(provider).toBeInstanceOf(YouTrackCollaborationProvider)
  })
})
