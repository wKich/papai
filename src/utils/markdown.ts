import { marked } from 'marked'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'markdown' })

/**
 * Converts LLM Markdown response to Telegram-compatible HTML
 * @param markdown - LLM output in Markdown format
 * @returns HTML string ready for Telegram parse_mode='HTML'
 */
export const formatMarkdownToHtml = (markdown: string): string => {
  log.debug({ markdownLength: markdown.length }, 'Converting Markdown to HTML')
  const html = marked.parse(markdown, {
    async: false,
    breaks: false,
    gfm: false,
  })
  log.debug({ markdownLength: markdown.length, htmlLength: html.length }, 'Markdown converted to HTML')
  return html
}
