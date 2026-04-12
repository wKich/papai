import { logger } from '../../logger.js'
import type { AuthorizationResult, CommandHandler, IncomingInteraction, IncomingMessage, ReplyFn } from '../types.js'
import type { ButtonInteractionLike } from './buttons.js'
import { buildDiscordInteraction } from './interaction-helpers.js'
import { createDiscordReplyFn } from './reply-helpers.js'

const log = logger.child({ scope: 'chat:discord' })

export async function tryDeferUpdate(interaction: ButtonInteractionLike): Promise<void> {
  try {
    await interaction.deferUpdate()
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error), customId: interaction.customId },
      'Failed to deferUpdate Discord button interaction',
    )
  }
}

export function buildInteraction(
  interaction: ButtonInteractionLike,
  adminUserId: string,
): {
  incoming: IncomingInteraction
  channel: NonNullable<ButtonInteractionLike['channel']>
  reply: ReplyFn
} | null {
  const channel = interaction.channel
  if (channel === null) return null

  const isAdmin = interaction.user.id === adminUserId
  const incomingInteraction = buildDiscordInteraction(
    {
      user: interaction.user,
      customId: interaction.customId,
      channelId: interaction.channelId,
      channel,
      message: interaction.message,
    },
    isAdmin,
  )

  if (incomingInteraction === null) return null

  const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
  return { incoming: incomingInteraction, channel, reply }
}

export function createFallbackMessage(
  interaction: ButtonInteractionLike,
  contextId: string,
  contextType: 'dm' | 'group',
  adminUserId: string,
): IncomingMessage {
  return {
    user: {
      id: interaction.user.id,
      username: interaction.user.username.length > 0 ? interaction.user.username : null,
      isAdmin: interaction.user.id === adminUserId,
    },
    contextId,
    contextType,
    isMentioned: true,
    text: interaction.customId,
    messageId: interaction.message.id,
  }
}

export async function routeButtonFallback(
  interaction: ButtonInteractionLike,
  channel: NonNullable<ButtonInteractionLike['channel']>,
  contextId: string,
  contextType: 'dm' | 'group',
  adminUserId: string,
  commands: Map<string, CommandHandler>,
  messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null,
): Promise<void> {
  const data = interaction.customId

  log.debug({ customId: data }, 'Unhandled button interaction in routeButtonFallback')

  const mapped = createFallbackMessage(interaction, contextId, contextType, adminUserId)
  const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })

  const trimmed = mapped.text.trim()
  if (!trimmed.startsWith('/')) {
    if (messageHandler !== null) await messageHandler(mapped, reply)
    return
  }

  const commandEntry = Array.from(commands.entries()).find(
    ([name]) => trimmed === `/${name}` || trimmed.startsWith(`/${name} `),
  )
  if (commandEntry !== undefined) {
    const [name, handler] = commandEntry
    mapped.commandMatch = trimmed.slice(name.length + 2).trim()
    const auth: AuthorizationResult = {
      allowed: true,
      isBotAdmin: mapped.user.isAdmin,
      isGroupAdmin: mapped.user.isAdmin,
      storageContextId: mapped.contextId,
    }
    await handler(mapped, reply, auth)
    return
  }

  if (messageHandler !== null) await messageHandler(mapped, reply)
}
