import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'

import { logger } from '../../logger.js'
import type { ChatButton } from '../types.js'

const log = logger.child({ scope: 'chat:discord:buttons' })

export const DISCORD_CUSTOM_ID_MAX = 100
export const DISCORD_BUTTONS_PER_ROW = 5
export const DISCORD_ROWS_PER_MESSAGE = 5

/** Channel interface for button interactions. */
export type ButtonChannelLike = {
  id: string
  type: number
  send: (arg: {
    content?: string
    components?: unknown[]
    reply?: { messageReference: string; failIfNotExists: boolean }
  }) => Promise<{ id: string; edit: (arg: { content?: string; components?: unknown[] }) => Promise<unknown> }>
  sendTyping: () => Promise<void>
}

/** Structural type for a Discord button interaction. */
export type ButtonInteractionLike = {
  user: { id: string; username: string }
  customId: string
  channelId: string
  channel: ButtonChannelLike | null
  message: { id: string }
  deferUpdate(): Promise<void>
}

/** Handler callback type for button interactions. */
export type ButtonCallbackHandler = (callbackData: string) => Promise<void>

/**
 * Dispatch a Discord button interaction to the appropriate handler.
 * Routes cfg:-prefixed callbacks to config editor and wizard_-prefixed to wizard.
 */
export async function dispatchButtonInteraction(
  interaction: ButtonInteractionLike,
  onConfigEditor: ButtonCallbackHandler,
  onWizard: ButtonCallbackHandler,
): Promise<void> {
  const data = interaction.customId

  // Always attempt to defer the update first
  try {
    await interaction.deferUpdate()
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error), customId: data },
      'Failed to deferUpdate Discord button interaction',
    )
  }

  // Route to config editor handler
  if (data.startsWith('cfg:')) {
    await onConfigEditor(data)
    return
  }

  // Route to wizard handler
  if (data.startsWith('wizard_')) {
    await onWizard(data)
    return
  }

  // Unrecognized callback - log but don't error
  log.debug({ customId: data }, 'Unrecognized button custom_id, ignoring')
}

// discord.js enum values: InteractionType.MessageComponent = 3, ComponentType.Button = 2
const INTERACTION_TYPE_MESSAGE_COMPONENT = 3
const COMPONENT_TYPE_BUTTON = 2

/** Runtime type guard for discord.js button interactions. */
export function isButtonInteraction(i: unknown): i is ButtonInteractionLike {
  if (typeof i !== 'object' || i === null) return false
  if (!('type' in i) || !('componentType' in i)) return false
  return i.type === INTERACTION_TYPE_MESSAGE_COMPONENT && i.componentType === COMPONENT_TYPE_BUTTON
}

const styleMap: Record<NonNullable<ChatButton['style']>, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  danger: ButtonStyle.Danger,
}

/** Convert papai ChatButtons to discord.js ActionRow components. */
export function toActionRows(buttons: ChatButton[]): ActionRowBuilder<ButtonBuilder>[] {
  const maxTotal = DISCORD_BUTTONS_PER_ROW * DISCORD_ROWS_PER_MESSAGE
  if (buttons.length > maxTotal) {
    throw new Error(
      `too many buttons: got ${String(buttons.length)}, max ${String(maxTotal)} (${String(DISCORD_ROWS_PER_MESSAGE)} rows × ${String(DISCORD_BUTTONS_PER_ROW)} per row)`,
    )
  }

  for (const btn of buttons) {
    if (btn.callbackData.length > DISCORD_CUSTOM_ID_MAX) {
      throw new Error(`custom_id exceeds ${String(DISCORD_CUSTOM_ID_MAX)} chars: "${btn.callbackData.slice(0, 20)}…"`)
    }
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = []
  for (let i = 0; i < buttons.length; i += DISCORD_BUTTONS_PER_ROW) {
    const slice = buttons.slice(i, i + DISCORD_BUTTONS_PER_ROW)
    const row = new ActionRowBuilder<ButtonBuilder>()
    for (const btn of slice) {
      const style = btn.style === undefined ? ButtonStyle.Secondary : styleMap[btn.style]
      row.addComponents(new ButtonBuilder().setCustomId(btn.callbackData).setLabel(btn.text).setStyle(style))
    }
    rows.push(row)
  }
  return rows
}
