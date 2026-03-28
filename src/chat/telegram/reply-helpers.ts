import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'

import type { ButtonReplyOptions, ReplyOptions } from '../types.js'
import { formatLlmOutput } from './format.js'

export type ReplyParamsBuilder = (options?: ReplyOptions) => { message_id: number } | undefined

export function createReplyParamsBuilder(ctx: Context): ReplyParamsBuilder {
  const messageId = ctx.message?.message_id
  return (options?: ReplyOptions): { message_id: number } | undefined => {
    if (options?.replyToMessageId !== undefined) {
      return { message_id: parseInt(options.replyToMessageId, 10) }
    }
    return messageId === undefined ? undefined : { message_id: messageId }
  }
}

export async function sendTextReply(
  ctx: Context,
  content: string,
  buildReplyParams: ReplyParamsBuilder,
  options?: ReplyOptions,
): Promise<void> {
  await ctx.reply(content, { reply_parameters: buildReplyParams(options) })
}

export async function sendFormattedReply(
  ctx: Context,
  markdown: string,
  buildReplyParams: ReplyParamsBuilder,
  options?: ReplyOptions,
): Promise<void> {
  const formatted = formatLlmOutput(markdown)
  await ctx.reply(formatted.text, {
    entities: formatted.entities,
    reply_parameters: buildReplyParams(options),
  })
}

export async function sendFileReply(
  ctx: Context,
  file: { content: Buffer | string; filename: string },
  buildReplyParams: ReplyParamsBuilder,
  options?: ReplyOptions,
): Promise<void> {
  const { InputFile } = await import('grammy')
  const content = typeof file.content === 'string' ? Buffer.from(file.content, 'utf-8') : file.content
  await ctx.replyWithDocument(new InputFile(content, file.filename), {
    reply_parameters: buildReplyParams(options),
  })
}

export async function sendButtonReply(
  ctx: Context,
  content: string,
  buildReplyParams: ReplyParamsBuilder,
  options: ButtonReplyOptions,
): Promise<void> {
  const keyboard = new InlineKeyboard()
  if (options.buttons !== undefined) {
    for (let i = 0; i < options.buttons.length; i += 2) {
      const btn1 = options.buttons[i]
      const btn2 = options.buttons[i + 1]
      if (btn1 !== undefined) {
        keyboard.text(btn1.text, btn1.callbackData)
      }
      if (btn2 !== undefined) {
        keyboard.text(btn2.text, btn2.callbackData)
      }
      keyboard.row()
    }
  }
  await ctx.reply(content, {
    reply_markup: keyboard,
    reply_parameters: buildReplyParams(options),
  })
}
