import { supportsInteractiveButtons } from '../chat/capabilities.js'
import type { ChatProvider, CommandHandler, ReplyFn } from '../chat/types.js'
import { startGroupSettingsSelection } from '../group-settings/selector.js'
import { logger } from '../logger.js'
import { createWizard } from '../wizard/engine.js'

const log = logger.child({ scope: 'commands:setup' })
const GROUP_SETUP_REDIRECT =
  'Group settings are configured in direct messages with the bot. Open a DM with me and run /setup.'
const GROUP_SETUP_ADMIN_ONLY =
  'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.'

function getTaskProvider(): 'kaneo' | 'youtrack' {
  const provider = process.env['TASK_PROVIDER']
  if (provider === 'kaneo' || provider === 'youtrack') {
    return provider
  }
  return 'kaneo'
}

const TASK_PROVIDER = getTaskProvider()

export async function startSetupForTarget(userId: string, reply: ReplyFn, targetContextId: string): Promise<void> {
  const result = createWizard(userId, targetContextId, TASK_PROVIDER)
  if (result.success) {
    await reply.text(result.prompt)
    return
  }
  await reply.text(result.prompt ?? 'Failed to start wizard. Please try again.')
}

async function replyWithSetupSelection(reply: ReplyFn, userId: string, interactiveButtons: boolean): Promise<void> {
  const selection = startGroupSettingsSelection(userId, 'setup', interactiveButtons)
  if ('continueWith' in selection) {
    await startSetupForTarget(userId, reply, selection.continueWith.targetContextId)
    return
  }
  if ('buttons' in selection && selection.buttons !== undefined) {
    await reply.buttons(selection.response, { buttons: selection.buttons })
    return
  }
  if ('response' in selection) {
    await reply.text(selection.response)
  }
}

export function registerSetupCommand(
  chat: ChatProvider,
  _checkAuthorization: (userId: string, username?: string | null) => boolean,
): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) {
      await reply.text('You are not authorized to use this bot.')
      return
    }

    if (msg.contextType === 'group') {
      await reply.text(auth.isGroupAdmin ? GROUP_SETUP_REDIRECT : GROUP_SETUP_ADMIN_ONLY)
      return
    }

    log.info({ userId: msg.user.id, contextId: auth.storageContextId }, '/setup command executed')
    await replyWithSetupSelection(reply, msg.user.id, supportsInteractiveButtons(chat))
  }

  chat.registerCommand('setup', handler)
}
