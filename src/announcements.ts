import packageJson from '../package.json' with { type: 'json' }
import { bot } from './bot.js'
import { readChangelogFile } from './changelog-reader.js'
import { getDb } from './db/index.js'
import { logger } from './logger.js'
import { formatLlmOutput } from './utils/format.js'

const log = logger.child({ scope: 'announcements' })

const VERSION: string = packageJson.version

export function extractChangelogSection(version: string, content: string): string | null {
  const lines = content.split('\n')
  const headerPrefix = `## [${version}]`
  const startIdx = lines.findIndex((line) => line.startsWith(headerPrefix))
  if (startIdx === -1) return null

  const endIdx = lines.findIndex((line, idx) => idx > startIdx && line.startsWith('## ['))
  const sectionLines = endIdx === -1 ? lines.slice(startIdx + 1) : lines.slice(startIdx + 1, endIdx)
  return sectionLines.join('\n').trim()
}

function markVersionAnnounced(version: string): boolean {
  const result = getDb().run('INSERT OR IGNORE INTO version_announcements (version, announced_at) VALUES (?, ?)', [
    version,
    new Date().toISOString(),
  ])
  const inserted = typeof result.changes === 'number' ? result.changes > 0 : false
  if (inserted) {
    log.info({ version }, 'Version marked as announced')
  }
  return inserted
}

function getUsersWithKaneoAccount(): number[] {
  return getDb()
    .query<{ user_id: number }, [string]>('SELECT DISTINCT user_id FROM user_config WHERE key = ?')
    .all('kaneo_apikey')
    .map((row) => row.user_id)
}

export async function announceNewVersion(): Promise<void> {
  log.debug({ version: VERSION }, 'Checking if version announcement is needed')

  let changelogContent: string
  try {
    changelogContent = await readChangelogFile()
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

  const claimed = markVersionAnnounced(VERSION)
  if (!claimed) {
    log.debug({ version: VERSION }, 'Version already announced, skipping')
    return
  }

  log.info({ version: VERSION, userCount: users.length }, 'Sending version announcement to users')

  const message = `🆕 papai v${VERSION} has been released!\n\n${changelogSection}`
  const formatted = formatLlmOutput(message)

  let successCount = 0
  for (const userId of users) {
    try {
      await bot.api.sendMessage(userId, formatted.text, { entities: formatted.entities })
      successCount++
      log.debug({ userId, version: VERSION }, 'Announcement sent to user')
    } catch (error) {
      log.warn(
        { userId, version: VERSION, error: error instanceof Error ? error.message : String(error) },
        'Failed to send announcement to user',
      )
    }
  }

  log.info({ version: VERSION, successCount, totalUsers: users.length }, 'Version announcement complete')
}
