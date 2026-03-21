import { announceNewVersion } from './announcements.js'
import { setupBot } from './bot.js'
import { createChatProvider } from './chat/registry.js'
import { getConfig } from './config.js'
import { closeDrizzleDb } from './db/drizzle.js'
import { closeMigrationDbInstance, initDb } from './db/index.js'
import { logger } from './logger.js'
import { proactiveScheduler } from './proactive/index.js'
import { createProvider } from './providers/registry.js'
import type { TaskProvider } from './providers/types.js'
import { startScheduler, stopScheduler } from './scheduler.js'
import { addUser, getKaneoWorkspace } from './users.js'

const hasSetCommands = (chat: unknown): chat is { setCommands: (adminUserId: string) => Promise<void> } =>
  typeof chat === 'object' && chat !== null && 'setCommands' in chat

const log = logger.child({ scope: 'main' })

const REQUIRED_ENV_VARS = ['CHAT_PROVIDER', 'ADMIN_USER_ID', 'TASK_PROVIDER'] as const

const missing = REQUIRED_ENV_VARS.filter((v) => (process.env[v]?.trim() ?? '') === '')
if (missing.length > 0) {
  log.error({ variables: missing }, 'Missing required environment variables')
  process.exit(1)
}

// Validate TASK_PROVIDER value and check provider-specific env vars
const TASK_PROVIDER = process.env['TASK_PROVIDER']!
if (TASK_PROVIDER !== 'kaneo' && TASK_PROVIDER !== 'youtrack') {
  log.error({ TASK_PROVIDER }, 'TASK_PROVIDER must be either "kaneo" or "youtrack"')
  process.exit(1)
}

if (TASK_PROVIDER === 'kaneo') {
  const missingKaneo = ['KANEO_CLIENT_URL'].filter((v) => (process.env[v]?.trim() ?? '') === '')
  if (missingKaneo.length > 0) {
    log.error({ variables: missingKaneo }, 'Missing required Kaneo environment variables')
    process.exit(1)
  }
}

if (TASK_PROVIDER === 'youtrack') {
  const missingYouTrack = ['YOUTRACK_URL'].filter((v) => (process.env[v]?.trim() ?? '') === '')
  if (missingYouTrack.length > 0) {
    log.error({ variables: missingYouTrack }, 'Missing required YouTrack environment variables')
    process.exit(1)
  }
}

log.info('Starting papai...')

try {
  initDb()
} catch (error) {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Database migration failed')
  process.exit(1)
}

const adminUserId = process.env['ADMIN_USER_ID']!
addUser(adminUserId, adminUserId)

const chatProvider = createChatProvider(process.env['CHAT_PROVIDER']!)

log.info(
  {
    adminUserConfigured: Boolean(adminUserId),
    chatProvider: process.env['CHAT_PROVIDER'],
    taskProvider: TASK_PROVIDER,
  },
  'Starting papai...',
)

setupBot(chatProvider, adminUserId)

await chatProvider.start()

if (hasSetCommands(chatProvider)) {
  void chatProvider.setCommands(adminUserId)
}

void announceNewVersion(chatProvider)

startScheduler(chatProvider)

// Build a task provider for a given user (used by proactive scheduler)
const buildProviderForUser = (userId: string): TaskProvider | null => {
  if (TASK_PROVIDER === 'kaneo') {
    const kaneoKey = getConfig(userId, 'kaneo_apikey')
    const kaneoBaseUrl = process.env['KANEO_CLIENT_URL']
    const workspaceId = getKaneoWorkspace(userId)
    if (kaneoKey === null || kaneoBaseUrl === undefined || kaneoBaseUrl === '' || workspaceId === null) return null
    const isSessionCookie = kaneoKey.startsWith('better-auth.session_token=')
    const config: Record<string, string> = isSessionCookie
      ? { baseUrl: kaneoBaseUrl, sessionCookie: kaneoKey, workspaceId }
      : { apiKey: kaneoKey, baseUrl: kaneoBaseUrl, workspaceId }
    return createProvider('kaneo', config)
  }
  if (TASK_PROVIDER === 'youtrack') {
    const baseUrl = process.env['YOUTRACK_URL']
    const token = getConfig(userId, 'youtrack_token')
    if (baseUrl === undefined || baseUrl === '' || token === null) return null
    return createProvider('youtrack', { baseUrl, token })
  }
  return null
}

proactiveScheduler.start(chatProvider, buildProviderForUser)

process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down gracefully')
  stopScheduler()
  proactiveScheduler.stopAll()
  void chatProvider.stop()
  closeDrizzleDb()
  closeMigrationDbInstance()
  process.exit(0)
})

process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down gracefully')
  stopScheduler()
  proactiveScheduler.stopAll()
  void chatProvider.stop()
  closeDrizzleDb()
  closeMigrationDbInstance()
  process.exit(0)
})
