import { eq } from 'drizzle-orm'

import packageJson from '../package.json' with { type: 'json' }
import { readChangelogFile as defaultReadChangelogFile } from './changelog-reader.js'
import type { ChatProvider } from './chat/types.js'
import { getDrizzleDb } from './db/drizzle.js'
import { userConfig, versionAnnouncements } from './db/schema.js'
import { logger } from './logger.js'
import { extractChangelogSection } from './utils/changelog.js'

export interface AnnouncementsDeps {
  readChangelogFile: () => Promise<string>
}

const defaultAnnouncementsDeps: AnnouncementsDeps = {
  readChangelogFile: defaultReadChangelogFile,
}

const log = logger.child({ scope: 'announcements' })

const VERSION: string = packageJson.version

function markVersionAnnounced(version: string): boolean {
  try {
    getDrizzleDb().insert(versionAnnouncements).values({ version, announcedAt: new Date().toISOString() }).run()
    log.info({ version }, 'Version marked as announced')
    return true
  } catch {
    // Unique constraint violation - version already announced
    return false
  }
}

function getUsersWithKaneoAccount(): string[] {
  return getDrizzleDb()
    .select({ userId: userConfig.userId })
    .from(userConfig)
    .where(eq(userConfig.key, 'kaneo_apikey'))
    .all()
    .map((row: { userId: string }) => row.userId)
}

async function sendAnnouncementsToUsers(userIds: string[], markdown: string, chat: ChatProvider): Promise<number> {
  const results = await Promise.allSettled(
    userIds.map(async (userId) => {
      try {
        await chat.sendMessage(userId, markdown)
        log.debug({ userId, version: VERSION }, 'Announcement sent to user')
        return true
      } catch (error) {
        log.warn(
          { userId, version: VERSION, error: error instanceof Error ? error.message : String(error) },
          'Failed to send announcement to user',
        )
        return false
      }
    }),
  )
  return results.filter((r) => r.status === 'fulfilled' && r.value).length
}

function shouldSkipAnnouncement(users: string[]): boolean {
  if (users.length === 0) {
    log.info({ version: VERSION }, 'No users with Kaneo account, skipping announcement')
    markVersionAnnounced(VERSION)
    return true
  }
  return false
}

export async function announceNewVersion(
  chat: ChatProvider,
  deps: AnnouncementsDeps = defaultAnnouncementsDeps,
): Promise<void> {
  log.debug({ version: VERSION }, 'Checking if version announcement is needed')

  const changelogSection = await loadChangelogSection(deps)
  if (changelogSection === null) return

  const users = getUsersWithKaneoAccount()
  if (shouldSkipAnnouncement(users)) return

  const claimed = markVersionAnnounced(VERSION)
  if (!claimed) {
    log.debug({ version: VERSION }, 'Version already announced, skipping')
    return
  }

  log.info({ version: VERSION, userCount: users.length }, 'Sending version announcement to users')

  const message = `🆕 papai v${VERSION} has been released!\n\n${changelogSection}`
  const successCount = await sendAnnouncementsToUsers(users, message, chat)

  log.info({ version: VERSION, successCount, totalUsers: users.length }, 'Version announcement complete')
}

async function loadChangelogSection(deps: AnnouncementsDeps): Promise<string | null> {
  let changelogContent: string
  try {
    changelogContent = await deps.readChangelogFile()
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Could not read CHANGELOG.md')
    return null
  }

  const section = extractChangelogSection(VERSION, changelogContent)
  if (section === null) {
    log.warn({ version: VERSION }, 'No changelog section found for version, skipping announcement')
    return null
  }
  return section
}
