/**
 * Wizard integration module
 * Handles wizard-related message processing separate from bot.ts
 */

import type { ReplyFn } from './chat/types.js'
import { processWizardMessage, hasActiveWizard } from './wizard/index.js'

/**
 * Handle a wizard message
 * Returns true if handled by wizard
 */
export async function handleWizardMessage(
  userId: string,
  storageContextId: string,
  text: string,
  reply: ReplyFn,
  supportsInteractiveButtons: boolean,
): Promise<boolean> {
  if (!hasActiveWizard(userId, storageContextId)) {
    return false
  }

  const wizardResult = await processWizardMessage(userId, storageContextId, text)

  if (wizardResult.handled) {
    const buttons = wizardResult.buttons
    const shouldShowButtons = supportsInteractiveButtons && buttons !== undefined && buttons.length > 0
    if (shouldShowButtons && buttons !== undefined) {
      // Send message with buttons
      const chatButtons: import('./chat/types.js').ChatButton[] = buttons.map((btn) => {
        let style: 'primary' | 'secondary' | 'danger' = 'primary'
        if (btn.action === 'cancel') {
          style = 'danger'
        } else if (btn.action === 'skip_small_model' || btn.action === 'skip_embedding') {
          style = 'secondary'
        }
        return {
          text: btn.text,
          callbackData: `wizard_${btn.action}`,
          style,
        }
      })
      await reply.buttons(wizardResult.response ?? '', { buttons: chatButtons })
    } else if (wizardResult.response !== undefined && wizardResult.response !== '') {
      await reply.text(wizardResult.response)
    }
    return true
  }

  return false
}
