import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'

import type { ChatButton } from '../types.js'

export const DISCORD_CUSTOM_ID_MAX = 100
export const DISCORD_BUTTONS_PER_ROW = 5
export const DISCORD_ROWS_PER_MESSAGE = 5

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
