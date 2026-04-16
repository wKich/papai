import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'

import type { ButtonReplyOptions, ReplyOptions } from '../types.js'
import { formatLlmOutput } from './format.js'

export type ReplyParamsBuilder = (
  options?: ReplyOptions,
) => { message_id: number; message_thread_id?: number } | undefined

/** Subset of Context properties that createReplyParamsBuilder uses */
export type ReplyContext = {
  message?: { message_id?: number; message_thread_id?: number }
}

/** Subset of Context properties that replacement reply helpers use */
export type ReplacementReplyContext = {
  editMessageText: (
    text: string,
    other?: { entities?: ReturnType<typeof formatLlmOutput>['entities']; reply_markup?: InlineKeyboard },
  ) => Promise<unknown>
}

export function createReplyParamsBuilder(ctx: ReplyContext, threadId?: string): ReplyParamsBuilder {
  const messageId = ctx.message?.message_id
  const contextThreadId = ctx.message?.message_thread_id

  return (options?: ReplyOptions): { message_id: number; message_thread_id?: number } | undefined => {
    const targetMessageId = options?.replyToMessageId === undefined ? messageId : parseInt(options.replyToMessageId, 10)

    if (targetMessageId === undefined) return undefined

    // Priority: explicit threadId param > options.threadId > context threadId
    const effectiveThreadId =
      threadId === undefined
        ? options?.threadId === undefined
          ? contextThreadId
          : parseInt(options.threadId, 10)
        : parseInt(threadId, 10)

    return {
      message_id: targetMessageId,
      ...(effectiveThreadId !== undefined && { message_thread_id: effectiveThreadId }),
    }
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
  const keyboard = buildInlineKeyboard(options)
  const formatted = formatLlmOutput(content)
  await ctx.reply(formatted.text, {
    entities: formatted.entities,
    reply_markup: keyboard,
    reply_parameters: buildReplyParams(options),
  })
}

export async function sendReplacementTextReply(ctx: ReplacementReplyContext, content: string): Promise<void> {
  const formatted = formatLlmOutput(content)
  await ctx.editMessageText(formatted.text, {
    entities: formatted.entities,
    reply_markup: new InlineKeyboard([]),
  })
}

export async function sendReplacementButtonReply(
  ctx: ReplacementReplyContext,
  content: string,
  options: ButtonReplyOptions,
): Promise<void> {
  const formatted = formatLlmOutput(content)
  await ctx.editMessageText(formatted.text, {
    entities: formatted.entities,
    reply_markup: buildInlineKeyboard(options),
  })
}

function buildInlineKeyboard(options: ButtonReplyOptions): InlineKeyboard {
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
  return keyboard
}
