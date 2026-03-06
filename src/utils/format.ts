import { markdownToFormattable } from '@gramio/format/markdown'
import type { TelegramMessageEntity } from '@gramio/types'
import type { MessageEntity } from '@grammyjs/types'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'format' })

const createBaseEntity = (entity: TelegramMessageEntity): { offset: number; length: number } => ({
  offset: entity.offset,
  length: entity.length,
})

const isValidDateTimeFormat = (value: string): value is MessageEntity.DateTimeMessageEntity['date_time_format'] => {
  // Valid patterns: "r" or combinations of optional "w", "d"/"D", "t"/"T"
  // e.g., "r", "d", "dt", "D", "Dt", "DT", "w", "wd", "wdt", etc.
  return /^[rwdDtT]*$/.test(value) && (value === 'r' || value.length <= 3)
}

const mapEntityWithExtras = (entity: TelegramMessageEntity): MessageEntity | null => {
  const base = createBaseEntity(entity)

  if (entity.type === 'pre' && entity.language !== undefined) {
    return { ...base, type: 'pre', language: entity.language }
  }

  if (entity.type === 'text_link' && entity.url !== undefined) {
    return { ...base, type: 'text_link', url: entity.url }
  }

  if (entity.type === 'text_mention' && entity.user !== undefined) {
    return { ...base, type: 'text_mention', user: entity.user }
  }

  if (entity.type === 'custom_emoji' && entity.custom_emoji_id !== undefined) {
    return { ...base, type: 'custom_emoji', custom_emoji_id: entity.custom_emoji_id }
  }

  if (
    entity.type === 'date_time' &&
    entity.unix_time !== undefined &&
    entity.date_time_format !== undefined &&
    isValidDateTimeFormat(entity.date_time_format)
  ) {
    return {
      ...base,
      type: 'date_time',
      unix_time: entity.unix_time,
      date_time_format: entity.date_time_format,
    }
  }

  return null
}

const mapCommonEntity = (entity: TelegramMessageEntity): MessageEntity => {
  const base = createBaseEntity(entity)

  switch (entity.type) {
    case 'pre':
      return { ...base, type: 'pre' }
    case 'text_link':
      return { ...base, type: 'text_link', url: '' }
    case 'text_mention':
      return { ...base, type: 'text_mention', user: { id: 0, is_bot: false, first_name: '' } }
    case 'custom_emoji':
      return { ...base, type: 'custom_emoji', custom_emoji_id: '' }
    case 'mention':
      return { ...base, type: 'mention' }
    case 'hashtag':
      return { ...base, type: 'hashtag' }
    case 'cashtag':
      return { ...base, type: 'cashtag' }
    case 'bot_command':
      return { ...base, type: 'bot_command' }
    case 'url':
      return { ...base, type: 'url' }
    case 'email':
      return { ...base, type: 'email' }
    case 'phone_number':
      return { ...base, type: 'phone_number' }
    case 'bold':
      return { ...base, type: 'bold' }
    case 'italic':
      return { ...base, type: 'italic' }
    case 'underline':
      return { ...base, type: 'underline' }
    case 'strikethrough':
      return { ...base, type: 'strikethrough' }
    case 'spoiler':
      return { ...base, type: 'spoiler' }
    case 'blockquote':
      return { ...base, type: 'blockquote' }
    case 'expandable_blockquote':
      return { ...base, type: 'expandable_blockquote' }
    case 'code':
      return { ...base, type: 'code' }
    // date_time is handled in mapEntityWithExtras, falls through to default
    case 'date_time':
    default:
      // For any unknown types, use 'bold' as safe default
      return { ...base, type: 'bold' }
  }
}

const mapToGrammyEntities = (entities: TelegramMessageEntity[]): MessageEntity[] =>
  entities.map((entity) => mapEntityWithExtras(entity) ?? mapCommonEntity(entity))

/**
 * Converts LLM Markdown response to Telegram-compatible format with grammy MessageEntity types
 * @param markdown - LLM output in Markdown format
 * @returns Object with text and entities compatible with grammy's reply method
 */
export const formatLlmOutput = (markdown: string): { text: string; entities: MessageEntity[] } => {
  log.debug({ markdownLength: markdown.length }, 'Converting Markdown to entities')
  const result = markdownToFormattable(markdown)
  log.debug(
    {
      textLength: result.text.length,
      entityCount: result.entities.length,
    },
    'Markdown converted to entities',
  )
  return {
    text: result.text,
    entities: mapToGrammyEntities(result.entities),
  }
}
