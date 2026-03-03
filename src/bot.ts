import { openai } from '@ai-sdk/openai'
import { generateText, stepCountIs } from 'ai'
import { type ModelMessage } from 'ai'
import { Bot } from 'grammy'

import { tools } from './tools.js'

const SYSTEM_PROMPT = `You are papai, an expert project manager and personal productivity assistant. \
You help the user manage their Linear tasks directly from Telegram.

You can:
- Create new issues with titles, descriptions, priorities, and project associations
- Update issue statuses and assignees
- Search for issues by keyword or state
- List available teams and projects

Always confirm actions to the user in a friendly, concise manner. \
When creating or updating tasks, summarize what was done and include the issue identifier and URL if available. \
If you need context (like project IDs), call list_projects first.`

const bot = new Bot(process.env['TELEGRAM_BOT_TOKEN']!)
const allowedUserId = parseInt(process.env['TELEGRAM_USER_ID']!, 10)

const conversationHistory = new Map<number, ModelMessage[]>()

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id
  if (!userId || userId !== allowedUserId) {
    return
  }

  const userText = ctx.message.text

  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, [])
  }
  const history = conversationHistory.get(userId)!

  history.push({ role: 'user', content: userText })

  // Keep only the last 40 messages to avoid unbounded memory / context growth
  if (history.length > 40) {
    history.splice(0, history.length - 40)
  }

  try {
    const result = await generateText({
      model: openai('gpt-4o'),
      system: SYSTEM_PROMPT,
      messages: history,
      tools,
      stopWhen: stepCountIs(5),
    })

    const assistantText = result.text

    history.push(...result.response.messages)

    await ctx.reply(assistantText || 'Done.')
  } catch (error) {
    // Remove the user message that failed so the history stays consistent
    history.pop()
    console.error('Error generating response:', error)
    await ctx.reply('Sorry, something went wrong. Please try again.')
  }
})

export { bot }
