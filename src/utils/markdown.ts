import { Marked } from 'marked'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'markdown' })

const telegram = new Marked({
  renderer: {
    // Block-level: convert unsupported tags to plain text with formatting

    paragraph({ tokens }): string {
      return `${this.parser.parseInline(tokens)}\n\n`
    },

    heading({ tokens, depth }): string {
      const text = this.parser.parseInline(tokens)
      return depth <= 2 ? `<b>${text}</b>\n\n` : `<b>${text}</b>\n`
    },

    list(token): string {
      let result = ''
      for (let i = 0; i < token.items.length; i++) {
        const item = token.items[i]!
        const prefix = token.ordered ? `${String(Number(token.start) + i)}. ` : '• '
        const body = this.parser.parse(item.tokens)
        result += `${prefix}${body.trimEnd()}\n`
      }
      return `${result}\n`
    },

    listitem(item): string {
      return this.parser.parse(item.tokens)
    },

    checkbox({ checked }): string {
      return checked ? '[x] ' : '[ ] '
    },

    code({ text, lang }): string {
      if (lang !== undefined && lang !== '') {
        return `<pre><code class="language-${lang}">${text}</code></pre>\n\n`
      }
      return `<pre><code>${text}</code></pre>\n\n`
    },

    blockquote({ tokens }): string {
      const body = this.parser.parse(tokens)
      return `<blockquote>${body.trimEnd()}</blockquote>\n\n`
    },

    hr(): string {
      return '\n'
    },

    table(token): string {
      let result = ''
      const headerCells = token.header.map((cell) => this.parser.parseInline(cell.tokens))
      result += headerCells.join(' | ') + '\n'
      for (const row of token.rows) {
        const cells = row.map((cell) => this.parser.parseInline(cell.tokens))
        result += cells.join(' | ') + '\n'
      }
      return `${result}\n`
    },

    tablerow(): string {
      return ''
    },

    tablecell(): string {
      return ''
    },

    // Inline: keep supported tags, strip unsupported ones

    strong({ tokens }): string {
      return `<b>${this.parser.parseInline(tokens)}</b>`
    },

    em({ tokens }): string {
      return `<i>${this.parser.parseInline(tokens)}</i>`
    },

    codespan({ text }): string {
      return `<code>${text}</code>`
    },

    del({ tokens }): string {
      return `<s>${this.parser.parseInline(tokens)}</s>`
    },

    link({ href, tokens }): string {
      return `<a href="${href}">${this.parser.parseInline(tokens)}</a>`
    },

    image({ href, text }): string {
      return text === '' ? href : text
    },

    br(): string {
      return '\n'
    },
  },
})

/**
 * Converts LLM Markdown response to Telegram-compatible HTML
 * @param markdown - LLM output in Markdown format
 * @returns HTML string ready for Telegram parse_mode='HTML'
 */
export const formatMarkdownToHtml = (markdown: string): string => {
  log.debug({ markdownLength: markdown.length }, 'Converting Markdown to HTML')
  const html = telegram
    .parse(markdown, {
      async: false,
      breaks: false,
      gfm: true,
    })
    .trim()
  log.debug({ markdownLength: markdown.length, htmlLength: html.length }, 'Markdown converted to HTML')
  return html
}
