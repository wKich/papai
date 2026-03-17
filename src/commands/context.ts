import type { ModelMessage } from 'ai'
import { InputFile } from 'grammy'
import type { Bot } from 'grammy'

import { loadHistory } from '../history.js'
import { logger } from '../logger.js'
import { loadFacts, loadSummary } from '../memory.js'

const log = logger.child({ scope: 'commands:context' })

type Fact = { identifier: string; title: string; url: string; last_seen: string }

function getTextFromPart(part: unknown): string | null {
  if (typeof part !== 'object' || part === null) {
    return null
  }
  if (!('text' in part)) {
    return null
  }
  const text = (part as { text: unknown })['text']
  return typeof text === 'string' ? text : null
}

function formatMessageContent(content: unknown): string {
  // For Telegram output, we only show text content
  // Complex parts (tool calls, etc.) are internal and not shown to users
  if (typeof content === 'string') {
    return content
  }

  // Extract text from array content (e.g., TextPart)
  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const part of content) {
      const text = getTextFromPart(part)
      if (text !== null) {
        texts.push(text)
      }
    }
    return texts.join('')
  }

  return ''
}

function formatHistorySection(history: readonly ModelMessage[]): string {
  if (history.length === 0) {
    return '(no messages)'
  }

  const lines: string[] = []
  for (let i = 0; i < history.length; i++) {
    const msg = history[i]
    if (msg === undefined) continue
    lines.push(`[${i + 1}] ${msg.role}:`)
    lines.push(formatMessageContent(msg.content))
    lines.push('')
  }
  return lines.join('\n')
}

function formatSummarySection(summary: string | null): string {
  if (summary === null || summary.length === 0) {
    return '(none)'
  }
  return summary
}

function formatFactsSection(facts: readonly Fact[]): string {
  if (facts.length === 0) {
    return '(none)'
  }

  const lines: string[] = []
  for (const f of facts) {
    const date = f.last_seen.slice(0, 10)
    lines.push(`- ${f.identifier}: "${f.title}"`)
    lines.push(`  URL: ${f.url}`)
    lines.push(`  Last seen: ${date}`)
    lines.push('')
  }
  return lines.join('\n')
}

function generateContextReport(
  history: readonly ModelMessage[],
  summary: string | null,
  facts: readonly Fact[],
): string {
  const lines: string[] = []

  lines.push('='.repeat(80))
  lines.push('HISTORY')
  lines.push('='.repeat(80))
  lines.push('')
  lines.push(formatHistorySection(history))

  lines.push('='.repeat(80))
  lines.push('SUMMARY')
  lines.push('='.repeat(80))
  lines.push('')
  lines.push(formatSummarySection(summary))
  lines.push('')

  lines.push('='.repeat(80))
  lines.push('KNOWN ENTITIES')
  lines.push('='.repeat(80))
  lines.push('')
  lines.push(formatFactsSection(facts))

  return lines.join('\n')
}

export function registerContextCommand(bot: Bot, adminUserId: number): void {
  bot.command('context', async (ctx) => {
    const userId = ctx.from?.id
    if (userId === undefined || userId !== adminUserId) {
      await ctx.reply('Only the admin can use this command.')
      return
    }
    log.debug({ userId }, '/context command called')

    const history = loadHistory(userId)
    const summary = loadSummary(userId)
    const facts = loadFacts(userId)

    const report = generateContextReport(history, summary, facts)

    const hasSummary = summary !== null && summary.length > 0
    log.info(
      { userId, historyLength: history.length, factsCount: facts.length, hasSummary },
      '/context command executed',
    )
    const content = Buffer.from(report, 'utf-8')
    await ctx.replyWithDocument(new InputFile(content, 'context.txt'))
  })
}
