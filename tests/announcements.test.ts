import { mock, describe, expect, test, beforeEach } from 'bun:test'

// --- Mock for db (must come before importing announcements.ts) ---
const announcedVersions = new Set<string>()
const userConfigRows: Array<{ user_id: number }> = []

class MockDatabase {
  run(sql: string, params?: (string | number | null)[]): { changes: number } {
    if (sql.includes('INSERT OR IGNORE INTO version_announcements') && params !== undefined) {
      const version = String(params[0])
      if (announcedVersions.has(version)) {
        return { changes: 0 }
      }
      announcedVersions.add(version)
      return { changes: 1 }
    }
    return { changes: 0 }
  }

  query(sql: string): {
    get: (...args: (string | number)[]) => Record<string, unknown> | null
    all: (...args: (string | number)[]) => Array<Record<string, unknown>>
  } {
    if (sql.includes('SELECT DISTINCT user_id FROM user_config')) {
      return {
        get: (): null => null,
        all: (): Array<Record<string, unknown>> => userConfigRows,
      }
    }
    return { get: (): null => null, all: (): Array<Record<string, unknown>> => [] }
  }
}

const mockDb = new MockDatabase()

void mock.module('../src/db/index.js', () => ({
  getDb: (): MockDatabase => mockDb,
  DB_PATH: ':memory:',
  initDb: (): void => {},
}))

// --- Mock for bot: delegate to sendMessageImpl so tests can override behavior ---
const sentMessages: Array<{ userId: number; text: string }> = []
let sendMessageImpl: (userId: number, text: string) => Promise<void> = (
  userId: number,
  text: string,
): Promise<void> => {
  sentMessages.push({ userId, text })
  return Promise.resolve()
}

void mock.module('../src/bot.js', () => ({
  bot: {
    api: {
      sendMessage: (userId: number, text: string): Promise<void> => sendMessageImpl(userId, text),
    },
  },
}))

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

import packageJson from '../package.json' with { type: 'json' }
import { announceNewVersion, extractChangelogSection } from '../src/announcements.js'

const VERSION: string = packageJson.version

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
    announcedVersions.clear()
    sentMessages.length = 0
    userConfigRows.length = 0
    changelogProvider = null
    sendMessageImpl = (userId: number, text: string): Promise<void> => {
      sentMessages.push({ userId, text })
      return Promise.resolve()
    }
  })

  test('sends announcement to all users with Kaneo accounts', async () => {
    userConfigRows.push({ user_id: 101 }, { user_id: 102 })
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion()

    expect(sentMessages).toHaveLength(2)
    expect(sentMessages[0]?.userId).toBe(101)
    expect(sentMessages[1]?.userId).toBe(102)
    expect(sentMessages[0]?.text).toContain(VERSION)
  })

  test('does not send announcement twice for the same version', async () => {
    userConfigRows.push({ user_id: 101 })
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion()
    await announceNewVersion()

    expect(sentMessages).toHaveLength(1)
  })

  test('marks version as announced even when no users have Kaneo accounts', async () => {
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion()

    expect(sentMessages).toHaveLength(0)
    expect(announcedVersions.has(VERSION)).toBe(true)
  })

  test('returns early without sending when CHANGELOG.md cannot be read', async () => {
    userConfigRows.push({ user_id: 101 })
    changelogProvider = null

    await announceNewVersion()

    expect(sentMessages).toHaveLength(0)
    expect(announcedVersions.has(VERSION)).toBe(false)
  })

  test('returns early without sending when version is missing from changelog', async () => {
    userConfigRows.push({ user_id: 101 })
    changelogProvider = (): Promise<string> =>
      Promise.resolve('# Changelog\n\n## [0.0.1] - 2024-01-01\n\n- old stuff\n')

    await announceNewVersion()

    expect(sentMessages).toHaveLength(0)
    expect(announcedVersions.has(VERSION)).toBe(false)
  })

  test('continues sending to remaining users when one send fails', async () => {
    const failedIds: number[] = []
    let callCount = 0

    sendMessageImpl = (userId: number, text: string): Promise<void> => {
      callCount++
      if (callCount === 1) {
        failedIds.push(userId)
        return Promise.reject(new Error('Telegram API error'))
      }
      sentMessages.push({ userId, text })
      return Promise.resolve()
    }

    userConfigRows.push({ user_id: 201 }, { user_id: 202 })
    changelogProvider = (): Promise<string> => Promise.resolve(CHANGELOG)

    await announceNewVersion()

    expect(failedIds).toHaveLength(1)
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]?.userId).toBe(202)
  })
})
