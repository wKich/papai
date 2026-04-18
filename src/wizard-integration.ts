/**
 * Wizard integration module
 * Handles wizard-related message processing separate from bot.ts
 */

import type { ReplyFn } from './chat/types.js'
import { processWizardMessage, hasActiveWizard } from './wizard/index.js'

const getWizardButtonStyle = (action: string): 'primary' | 'secondary' | 'danger' => {
  if (action === 'cancel') {
    return 'danger'
  }
  if (action === 'skip_small_model' || action === 'skip_embedding') {
    return 'secondary'
  }
  return 'primary'
}

const getWizardContextSuffix = (targetContextId: string | undefined): string => {
  if (targetContextId === undefined) {
    return ''
  }
  return `@${Buffer.from(targetContextId).toString('base64url')}`
}

const getWizardResponseText = (response: string | undefined): string => {
  if (response === undefined) {
    return ''
  }
  return response
}

const getWizardButtons = (
  buttons: NonNullable<Awaited<ReturnType<typeof processWizardMessage>>['buttons']>,
  targetContextId: string | undefined,
): import('./chat/types.js').ChatButton[] => {
  const contextSuffix = getWizardContextSuffix(targetContextId)
  return buttons.map((button) => ({
    text: button.text,
    callbackData: `wizard_${button.action}${contextSuffix}`,
    style: getWizardButtonStyle(button.action),
  }))
}

/**
 * Handle a wizard message
 * Returns true if handled by wizard
 */
export async function handleWizardMessage(
  ...args:
    | [userId: string, storageContextId: string, text: string, reply: ReplyFn, supportsInteractiveButtons: boolean]
    | [
        userId: string,
        storageContextId: string,
        text: string,
        reply: ReplyFn,
        supportsInteractiveButtons: boolean,
        targetContextId: string | undefined,
      ]
): Promise<boolean> {
  const [userId, storageContextId, text, reply, supportsInteractiveButtons, targetContextId] = args
  if (!hasActiveWizard(userId, storageContextId)) {
    return false
  }

  const wizardResult = await processWizardMessage(userId, storageContextId, text)

  if (wizardResult.handled) {
    const buttons = wizardResult.buttons
    const shouldShowButtons = supportsInteractiveButtons && buttons !== undefined && buttons.length > 0
    if (shouldShowButtons && buttons !== undefined) {
      await reply.buttons(getWizardResponseText(wizardResult.response), {
        buttons: getWizardButtons(buttons, targetContextId),
      })
    } else if (wizardResult.response !== undefined && wizardResult.response !== '') {
      await reply.text(wizardResult.response)
    }
    return true
  }

  return false
}
