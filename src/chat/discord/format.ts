import { chunkForDiscord } from './format-chunking.js'

const DISCORD_MAX_CONTENT_LEN = 2000

/**
 * Normalize LLM markdown for Discord's dialect and chunk the result.
 * Discord's markdown is a near-superset of papai's LLM output, so most of
 * the transformation is defensive: flatten tables (Discord does not render
 * them), zero-width-escape @everyone / @here, and chunk at 2000 chars.
 */
export function formatLlmOutput(markdown: string): string[] {
  const stepOne = flattenTables(markdown)
  const stepTwo = escapeMassMentions(stepOne)
  return chunkForDiscord(stepTwo, DISCORD_MAX_CONTENT_LEN)
}

function flattenTables(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const next = lines[i + 1]
    if (line.trim().startsWith('|') && next !== undefined && /^\|[\s-:|]+\|\s*$/.test(next.trim())) {
      const header = stripPipes(line)
      out.push(header)
      i += 2
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        out.push(stripPipes(lines[i]!))
        i++
      }
      continue
    }
    out.push(line)
    i++
  }
  return out.join('\n')
}

function stripPipes(row: string): string {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
    .join(' | ')
}

function escapeMassMentions(text: string): string {
  return text.replace(/@everyone/g, '@\u200beveryone').replace(/@here/g, '@\u200bhere')
}
