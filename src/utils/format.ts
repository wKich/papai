import type { FormattableString } from '@gramio/format'
import { markdownToFormattable } from '@gramio/format/markdown'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'format' })

/**
 * Converts LLM Markdown response to Telegram-compatible MessageEntity format
 * @param markdown - LLM output in Markdown format
 * @returns FormattableString with text and entities ready for Telegram
 */
export const formatLlmOutput = (markdown: string): FormattableString => {
  log.debug({ markdownLength: markdown.length }, 'Converting Markdown to entities')
  const result = markdownToFormattable(markdown)
  log.debug(
    {
      textLength: result.text.length,
      entityCount: result.entities.length,
    },
    'Markdown converted to entities',
  )
  return result
}
