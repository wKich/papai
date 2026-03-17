import { InputFile } from 'grammy'
import type { Bot } from 'grammy'

import { loadHistory } from '../history.js'
import { logger } from '../logger.js'
import { loadFacts, loadSummary } from '../memory.js'

const log = logger.child({ scope: 'commands:context' })

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

    const lines: string[] = []

    lines.push(`History: ${history.length} messages`)

    if (summary !== null && summary.length > 0) {
      lines.push('', 'Summary:', summary)
    } else {
      lines.push('', 'Summary: (none)')
    }

    if (facts.length > 0) {
      lines.push('', 'Known entities:')
      for (const f of facts) {
        const date = f.last_seen.slice(0, 10)
        lines.push(`- ${f.identifier}: "${f.title}" — last seen ${date}`)
      }
    } else {
      lines.push('', 'Known entities: (none)')
    }

    const hasSummary = summary !== null && summary.length > 0
    log.info(
      { userId, historyLength: history.length, factsCount: facts.length, hasSummary },
      '/context command executed',
    )
    const content = Buffer.from(lines.join('\n'), 'utf-8')
    await ctx.replyWithDocument(new InputFile(content, 'context.txt'))
  })
}
