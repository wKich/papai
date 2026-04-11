import { logger } from '../logger.js'
import { supportsCommandMenu } from './capabilities.js'
import type { ChatProvider } from './types.js'

const log = logger.child({ scope: 'chat:startup' })

/**
 * Calls `chat.setCommands(adminUserId)` only when the provider supports a native
 * bot command menu (`commands.menu` capability). No-ops silently for providers
 * that don't support it.
 */
export async function registerCommandMenuIfSupported(chat: ChatProvider, adminUserId: string): Promise<void> {
  if (!supportsCommandMenu(chat)) {
    log.debug({ provider: chat.name }, 'Command menu not supported, skipping setCommands')
    return
  }

  log.debug({ provider: chat.name }, 'Registering command menu')
  await chat.setCommands?.(adminUserId)
}
