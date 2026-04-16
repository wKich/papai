import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { BEHAVIORS_DIR, STORIES_DIR } from './config.js'
import { getDomain } from './domain-map.js'

export interface ExtractedBehavior {
  readonly testName: string
  readonly fullPath: string
  readonly behavior: string
  readonly context: string
}

export interface EvaluatedBehavior {
  readonly testName: string
  readonly behavior: string
  readonly userStory: string
  readonly maria: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly dani: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly viktor: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
}

export async function writeBehaviorFile(testFilePath: string, behaviors: readonly ExtractedBehavior[]): Promise<void> {
  const domain = getDomain(testFilePath)
  const fileName = testFilePath.split('/').pop()!.replace('.test.ts', '.test.behaviors.md')
  const outPath = join(BEHAVIORS_DIR, domain, fileName)
  await mkdir(dirname(outPath), { recursive: true })

  const lines: string[] = [`# ${testFilePath}\n`]
  for (const b of behaviors) {
    lines.push(`## Test: "${b.fullPath}"\n`)
    lines.push(`**Behavior:** ${b.behavior}`)
    lines.push(`**Context:** ${b.context}\n`)
  }

  await Bun.write(outPath, lines.join('\n'))
}

function domainTitle(domain: string): string {
  return domain
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function writeStoryFile(domain: string, evaluations: readonly EvaluatedBehavior[]): Promise<void> {
  const outPath = join(STORIES_DIR, `${domain}.md`)
  await mkdir(dirname(outPath), { recursive: true })

  const lines: string[] = [`# ${domainTitle(domain)} — User Stories & UX Evaluation\n`]

  for (const e of evaluations) {
    lines.push(`## "${e.testName}"\n`)
    lines.push(`**User Story:** ${e.userStory}\n`)
    lines.push('| Persona | Discover | Use | Retain | Notes |')
    lines.push('|---------|----------|-----|--------|-------|')
    lines.push(
      `| Maria   | ${e.maria.discover}        | ${e.maria.use}   | ${e.maria.retain}      | ${e.maria.notes} |`,
    )
    lines.push(`| Dani    | ${e.dani.discover}        | ${e.dani.use}   | ${e.dani.retain}      | ${e.dani.notes} |`)
    lines.push(
      `| Viktor  | ${e.viktor.discover}        | ${e.viktor.use}   | ${e.viktor.retain}      | ${e.viktor.notes} |`,
    )
    lines.push('')
    if (e.flaws.length > 0) {
      lines.push('**Flaws:**\n')
      for (const flaw of e.flaws) lines.push(`- ${flaw}`)
      lines.push('')
    }
    if (e.improvements.length > 0) {
      lines.push('**Improvements:**\n')
      for (const imp of e.improvements) lines.push(`- ${imp}`)
      lines.push('')
    }
  }

  await Bun.write(outPath, lines.join('\n'))
}

interface DomainSummary {
  readonly domain: string
  readonly count: number
  readonly avgDiscover: number
  readonly avgUse: number
  readonly avgRetain: number
  readonly worstPersona: string
}

interface FailedItem {
  readonly testFile: string
  readonly testName: string
  readonly error: string
  readonly attempts: number
}

function buildSummaryHeader(
  summaries: readonly DomainSummary[],
  totalProcessed: number,
  totalFailed: number,
): readonly string[] {
  const lines: string[] = [
    '# Behavior Audit Summary\n',
    `**Generated:** ${new Date().toISOString()}`,
    `**Tests processed:** ${totalProcessed}`,
    `**Behaviors failed:** ${totalFailed}\n`,
    '| Domain | Behaviors | Avg Discover | Avg Use | Avg Retain | Worst Persona |',
    '|--------|-----------|-------------|---------|------------|---------------|',
  ]
  for (const s of summaries) {
    lines.push(
      `| ${s.domain} | ${s.count} | ${s.avgDiscover.toFixed(1)} | ${s.avgUse.toFixed(1)} | ${s.avgRetain.toFixed(1)} | ${s.worstPersona} |`,
    )
  }
  lines.push('')
  return lines
}

function buildTopItemsSection(title: string, items: ReadonlyMap<string, number>): readonly string[] {
  const sorted = [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  if (sorted.length === 0) return []
  return [`## ${title}\n`, ...sorted.map(([item, count], i) => `${i + 1}. "${item}" (${count})`), '']
}

function buildFailedSection(failedItems: readonly FailedItem[]): readonly string[] {
  if (failedItems.length === 0) return []
  return [
    '## Failed Extractions\n',
    '| Test File | Test Name | Error | Attempts |',
    '|-----------|-----------|-------|----------|',
    ...failedItems.map((f) => `| ${f.testFile} | ${f.testName} | ${f.error} | ${f.attempts} |`),
    '',
  ]
}

export async function writeIndexFile(
  summaries: readonly DomainSummary[],
  totalProcessed: number,
  totalFailed: number,
  flawFrequency: ReadonlyMap<string, number>,
  improvementFrequency: ReadonlyMap<string, number>,
  failedItems: readonly FailedItem[],
): Promise<void> {
  const outPath = join(STORIES_DIR, 'index.md')
  await mkdir(dirname(outPath), { recursive: true })

  const lines = [
    ...buildSummaryHeader(summaries, totalProcessed, totalFailed),
    ...buildTopItemsSection('Top 10 Flaws (by frequency)', flawFrequency),
    ...buildTopItemsSection('Top 10 Improvements (by frequency)', improvementFrequency),
    ...buildFailedSection(failedItems),
  ]

  await Bun.write(outPath, lines.join('\n'))
}
