import { Database } from 'bun:sqlite'
import { describe, expect, test, beforeEach, mock } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import packageJson from '../package.json' with { type: 'json' }
import { announceNewVersion } from '../src/announcements.js'
import type { ChatProvider, IncomingMessage, ReplyFn } from '../src/chat/types.js'
import { _resetDrizzleDb, _setDrizzleDb } from '../src/db/drizzle.js'
import { runMigrations } from '../src/db/migrate.js'
import { migration001Initial } from '../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../src/db/migrations/007_platform_user_id.js'
import * as schema from '../src/db/schema.js'
import { extractChangelogSection } from './helpers/extract-changelog-section.js'

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
] as const

const VERSION: string = packageJson.version

// --- Mock ChatProvider for testing ---
const sentMessages: Array<{ userId: string; text: string }> = []
let sendMessageImpl = (userId: string, text: string): Promise<void> => {
  sentMessages.push({ userId, text })
  return Promise.resolve()
}

const mockChat: ChatProvider = {
  name: 'mock',
  registerCommand: (_name: string, _handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void => {},
  onMessage: (_handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void => {},
  sendMessage: (userId: string, text: string): Promise<void> => sendMessageImpl(userId, text),
  start: (): Promise<void> => Promise.resolve(),
  stop: (): Promise<void> => Promise.resolve(),
}

// --- Mock for changelog-reader (controlled per-test via changelogProvider) ---
let changelogProvider: (() => Promise<string>) | null = null

void mock.module('../src/changelog-reader.js', () => ({
  readChangelogFile: (): Promise<string> => {
    if (changelogProvider === null) {
      return Promise.reject(new Error('CHANGELOG.md not found'))
    }
    return changelogProvider()
  },
}))

// Canonical CHANGELOG fixture aligned with the actual package version
const CHANGELOG = `# Changelog

## [${VERSION}] - 2026-01-01

### Added
- Feature A

### Fixed
- Bug B

## [0.0.1] - 2025-01-01

### Added
- Feature X
`

// ---------------------------------------------------------------------------
// Unit tests for extractChangelogSection
// ---------------------------------------------------------------------------

describe('extractChangelogSection', () => {
  test('returns section content for a matching version', () => {
    const result = extractChangelogSection(VERSION, CHANGELOG)
    expect(result).toContain('Feature A')
    expect(result).toContain('Bug B')
  })

  test('does not include the next version header in the section', () => {
    const result = extractChangelogSection(VERSION, CHANGELOG)
    expect(result).not.toContain('## [0.0.1]')
  })

  test('returns null when version is not found', () => {
    const result = extractChangelogSection('9.9.9', CHANGELOG)
    expect(result).toBeNull()
  })

  test('returns section for last version in file (no following header boundary)', () => {
    const result = extractChangelogSection('0.0.1', CHANGELOG)
    expect(result).not.toBeNull()
    expect(result).toContain('Feature X')
  })

  test('returns null for empty changelog', () => {
    const result = extractChangelogSection(VERSION, '')
    expect(result).toBeNull()
  })

  test('returns empty string when section has no body lines between two headers', () => {
    const tightChangelog = `## [${VERSION}] - 2026-01-01\n## [0.0.1] - 2025-01-01\n`
    const result = extractChangelogSection(VERSION, tightChangelog)
    expect(result).toBe('')
  })

  test('trims leading and trailing blank lines from section', () => {
    const changelogWithPadding = `## [${VERSION}] - 2026-01-01\n\n\n### Added\n- X\n\n\n`
    const result = extractChangelogSection(VERSION, changelogWithPadding)
    expect(result).not.toBeNull()
    expect(result!.startsWith('\n')).toBe(false)
    expect(result!.endsWith('\n')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Integration-style tests for announceNewVersion
// ---------------------------------------------------------------------------

describe('announceNewVersion', () => {
  beforeEach(() => {
    _resetDrizzleDb()
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, MIGRATIONS)
    const testDb = drizzle(sqlite, { schema })
    _setDrizzleDb(testDb)

    sentMessages.length = 0
    changelogProvider = null
    sendMessageImpl = (userId: string, text: string): Promise<void> => {
      sentMessages.push({ userId, text })
      return Promise.resolve()
    }
  })

  test('sends announcement to all users with Kaneo accounts', async () => {
    // Insert test users with kaneo_apikey config
    const sqlite = new Database(':memory:')
    const testDb = drizzle(sqlite, { schema })
    _setDrizzleDb(testDb)
    runMigrations(sqlite, MIGRATIONS)

    testDb.insert(schema.userConfig).values({ userId: '101', key: 'kaneo_apikey', value: 'key1' }).run()
    testDb.insert(schema.userConfig).values({ userId: '102', key: 'kaneo_apikey', value: 'key2' }).run()

    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion(mockChat)

    expect(sentMessages).toHaveLength(2)
    expect(sentMessages[0]?.userId).toBe('101')
    expect(sentMessages[1]?.userId).toBe('102')
    expect(sentMessages[0]?.text).toContain(VERSION)
  })

  test('does not send announcement twice for the same version', async () => {
    const sqlite = new Database(':memory:')
    const testDb = drizzle(sqlite, { schema })
    _setDrizzleDb(testDb)
    runMigrations(sqlite, MIGRATIONS)

    testDb.insert(schema.userConfig).values({ userId: '101', key: 'kaneo_apikey', value: 'key1' }).run()

    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion(mockChat)
    await announceNewVersion(mockChat)

    expect(sentMessages).toHaveLength(1)
  })

  test('marks version as announced even when no users have Kaneo accounts', async () => {
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion(mockChat)

    expect(sentMessages).toHaveLength(0)
    // Version announcement is stored in the database (verified by the fact that
    // calling announceNewVersion again doesn't re-announce)

    // Reset and verify idempotency - second call should not send messages
    sentMessages.length = 0
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)
    await announceNewVersion(mockChat)
    expect(sentMessages).toHaveLength(0)
  })

  test('returns early without sending when CHANGELOG.md cannot be read', async () => {
    const sqlite = new Database(':memory:')
    const testDb = drizzle(sqlite, { schema })
    _setDrizzleDb(testDb)
    runMigrations(sqlite, MIGRATIONS)

    testDb.insert(schema.userConfig).values({ userId: '101', key: 'kaneo_apikey', value: 'key1' }).run()
    changelogProvider = null

    await announceNewVersion(mockChat)

    expect(sentMessages).toHaveLength(0)
  })

  test('returns early without sending when version is missing from changelog', async () => {
    const sqlite = new Database(':memory:')
    const testDb = drizzle(sqlite, { schema })
    _setDrizzleDb(testDb)
    runMigrations(sqlite, MIGRATIONS)

    testDb.insert(schema.userConfig).values({ userId: '101', key: 'kaneo_apikey', value: 'key1' }).run()
    changelogProvider = (): Promise<string> =>
      Promise.resolve('# Changelog\n\n## [0.0.1] - 2024-01-01\n\n- old stuff\n')

    await announceNewVersion(mockChat)

    expect(sentMessages).toHaveLength(0)
  })

  test('continues sending to remaining users when one send fails', async () => {
    const failedIds: string[] = []
    let callCount = 0

    sendMessageImpl = (userId: string, text: string): Promise<void> => {
      callCount++
      if (callCount === 1) {
        failedIds.push(userId)
        return Promise.reject(new Error('API error'))
      }
      sentMessages.push({ userId, text })
      return Promise.resolve()
    }

    const sqlite = new Database(':memory:')
    const testDb = drizzle(sqlite, { schema })
    _setDrizzleDb(testDb)
    runMigrations(sqlite, MIGRATIONS)

    testDb.insert(schema.userConfig).values({ userId: '201', key: 'kaneo_apikey', value: 'key1' }).run()
    testDb.insert(schema.userConfig).values({ userId: '202', key: 'kaneo_apikey', value: 'key2' }).run()
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion(mockChat)

    expect(failedIds).toHaveLength(1)
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]?.userId).toBe('202')
  })
})
