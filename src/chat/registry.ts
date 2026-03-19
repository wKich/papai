import { logger } from '../logger.js'
import type { ChatProvider } from './types.js'

const log = logger.child({ scope: 'chat:registry' })

type ChatProviderFactory = () => ChatProvider

const providers = new Map<string, ChatProviderFactory>()

export function registerChatProvider(name: string, factory: ChatProviderFactory): void {
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
