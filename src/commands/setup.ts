import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'
import { createWizard } from '../wizard/engine.js'

const log = logger.child({ scope: 'commands:setup' })

function getTaskProvider(): 'kaneo' | 'youtrack' {
  const provider = process.env['TASK_PROVIDER']
  if (provider === 'kaneo' || provider === 'youtrack') {
    return provider
  }
  return 'kaneo'
}

const TASK_PROVIDER = getTaskProvider()

export function registerSetupCommand(
  chat: ChatProvider,
  _checkAuthorization: (userId: string, username?: string | null) => boolean,
): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) {
      await reply.text('You are not authorized to use this bot.')
      return
    }

    log.info({ userId: msg.user.id, contextId: auth.storageContextId }, '/setup command executed')

    // Create wizard session - actual prompts handled by wizard engine
    const result = createWizard(msg.user.id, auth.storageContextId, TASK_PROVIDER)

    if (result.success) {
      await reply.text(result.prompt)
    } else {
      await reply.text(result.prompt ?? 'Failed to start wizard. Please try again.')
    }
  }

  chat.registerCommand('setup', handler)
}
