import { logger } from '../logger.js'
import { MattermostChatProvider } from './mattermost/index.js'
import { TelegramChatProvider } from './telegram/index.js'
import type { ChatProvider } from './types.js'

const log = logger.child({ scope: 'chat:registry' })

type ChatProviderFactory = () => ChatProvider

const providers = new Map<string, ChatProviderFactory>()

registerChatProvider('telegram', () => new TelegramChatProvider())
registerChatProvider('mattermost', () => new MattermostChatProvider())

function registerChatProvider(name: string, factory: ChatProviderFactory): void {
  providers.set(name, factory)
}

export function createChatProvider(name: string): ChatProvider {
  const factory = providers.get(name)
  if (factory === undefined) {
    log.error({ name }, 'Unknown chat provider requested')
    throw new Error(`Unknown chat provider: ${name}. Available: ${[...providers.keys()].join(', ')}`)
  }
  log.debug({ name }, 'Creating chat provider instance')
  return factory()
}
