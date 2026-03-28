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
    for (const btn of options.buttons) {
      keyboard.text(btn.text, btn.callbackData)
    }
  }
  await ctx.reply(content, {
    reply_markup: keyboard,
    reply_parameters: buildReplyParams(options),
  })
}
