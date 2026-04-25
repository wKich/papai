import { logger } from '../logger.js'
import { pluginRegistry, setPluginEnabledForContext } from '../plugins/registry.js'
import { replyTextPreferReplace } from './interaction-router-replies.js'
import type { IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:plugin-interaction' })

/** Handle plg: callback interactions for enabling/disabling plugins per context. */
export async function handlePluginInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData } = interaction
  if (!callbackData.startsWith('plg:')) return false

  // Format: plg:<action>:<pluginId>:<contextId>
  const parts = callbackData.slice(4).split(':')
  const action = parts[0]
  const pluginId = parts[1]
  const contextId = parts[2]

  if (action === undefined || pluginId === undefined || contextId === undefined) {
    log.warn({ callbackData }, 'Malformed plugin interaction callback')
    await replyTextPreferReplace(reply, 'Invalid plugin action. Please try again.')
    return true
  }

  if (action === 'enable') {
    const entry = pluginRegistry.getEntry(pluginId)
    if (entry === undefined || entry.state !== 'active') {
      await replyTextPreferReplace(reply, `Plugin \`${pluginId}\` is not available.`)
      return true
    }
    setPluginEnabledForContext(pluginId, contextId, true)
    log.info({ pluginId, contextId, userId: interaction.user.id }, 'Plugin enabled via interaction')
    await replyTextPreferReplace(reply, `🟢 Plugin \`${pluginId}\` enabled.`)
    return true
  }

  if (action === 'disable') {
    setPluginEnabledForContext(pluginId, contextId, false)
    log.info({ pluginId, contextId, userId: interaction.user.id }, 'Plugin disabled via interaction')
    await replyTextPreferReplace(reply, `⭕ Plugin \`${pluginId}\` disabled.`)
    return true
  }

  log.warn({ callbackData, action }, 'Unknown plugin interaction action')
  await replyTextPreferReplace(reply, 'Unknown plugin action.')
  return true
}
