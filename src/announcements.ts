import { bot } from './bot.js'
import { getDb } from './db/index.js'
import { logger } from './logger.js'
import packageJson from '../package.json' with { type: 'json' }

const log = logger.child({ scope: 'announcements' })

const VERSION: string = packageJson.version

function extractChangelogSection(version: string, content: string): string | null {
  const lines = content.split('\n')
  const headerPrefix = `## [${version}]`
  const startIdx = lines.findIndex((line) => line.startsWith(headerPrefix))
  if (startIdx === -1) return null

  const endIdx = lines.findIndex((line, idx) => idx > startIdx && line.startsWith('## ['))
  const sectionLines = endIdx === -1 ? lines.slice(startIdx + 1) : lines.slice(startIdx + 1, endIdx)
  return sectionLines.join('\n').trim()
}

function isVersionAnnounced(version: string): boolean {
  const row = getDb()
    .query<{ version: string }, [string]>('SELECT version FROM version_announcements WHERE version = ?')
    .get(version)
  return row !== null
}

function markVersionAnnounced(version: string): void {
  getDb().run('INSERT OR IGNORE INTO version_announcements (version, announced_at) VALUES (?, ?)', [
    version,
    new Date().toISOString(),
  ])
  log.info({ version }, 'Version marked as announced')
}

function getUsersWithKaneoAccount(): number[] {
  return getDb()
    .query<{ user_id: number }, [string]>('SELECT DISTINCT user_id FROM user_config WHERE key = ?')
    .all('kaneo_apikey')
    .map((row) => row.user_id)
}

export async function announceNewVersion(): Promise<void> {
  log.debug({ version: VERSION }, 'Checking if version announcement is needed')

  if (isVersionAnnounced(VERSION)) {
    log.debug({ version: VERSION }, 'Version already announced, skipping')
    return
  }

  let changelogContent: string
  try {
    changelogContent = await Bun.file(new URL('../CHANGELOG.md', import.meta.url)).text()
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Could not read CHANGELOG.md')
    return
  }

  const changelogSection = extractChangelogSection(VERSION, changelogContent)
  if (changelogSection === null) {
    log.warn({ version: VERSION }, 'No changelog section found for version, skipping announcement')
    return
  }

  const users = getUsersWithKaneoAccount()
  if (users.length === 0) {
    log.info({ version: VERSION }, 'No users with Kaneo account, skipping announcement')
    markVersionAnnounced(VERSION)
    return
  }

  log.info({ version: VERSION, userCount: users.length }, 'Sending version announcement to users')

  const message = `🆕 papai v${VERSION} has been released!\n\n${changelogSection}`
  const MAX_LENGTH = 4096
  const truncated = message.length > MAX_LENGTH ? `${message.slice(0, MAX_LENGTH - 3)}...` : message

  let successCount = 0
  for (const userId of users) {
    try {
      await bot.api.sendMessage(userId, truncated)
      successCount++
      log.debug({ userId, version: VERSION }, 'Announcement sent to user')
    } catch (error) {
      log.warn(
        { userId, version: VERSION, error: error instanceof Error ? error.message : String(error) },
        'Failed to send announcement to user',
      )
    }
  }

  markVersionAnnounced(VERSION)
  log.info({ version: VERSION, successCount, totalUsers: users.length }, 'Version announcement complete')
}
