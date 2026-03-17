import type { Bot } from 'grammy'

import { loadHistory } from '../history.js'
import { logger } from '../logger.js'
import { loadFacts, loadSummary } from '../memory.js'

const log = logger.child({ scope: 'commands:context' })

export function registerContextCommand(
  bot: Bot,
  checkAuthorization: (userId: number | undefined, username?: string) => userId is number,
): void {
  bot.command('context', async (ctx) => {
    const userId = ctx.from?.id
    if (!checkAuthorization(userId, ctx.from?.username)) return
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

    log.info(
      {
        userId,
        historyLength: history.length,
        factsCount: facts.length,
        hasSummary: summary !== null && summary.length > 0,
      },
      '/context command executed',
    )
    await ctx.reply(lines.join('\n'))
  })
}
