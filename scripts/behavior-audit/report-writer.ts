import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { BEHAVIORS_DIR, CONSOLIDATED_DIR, STORIES_DIR } from './config.js'
import { getDomain } from './domain-map.js'
import type { IncrementalManifest } from './incremental.js'
import {
  buildFailedSection,
  buildSummaryHeader,
  buildTopItemsSection,
  type DomainSummary,
  type FailedItem,
} from './report-index-helpers.js'
export type { DomainSummary, FailedItem } from './report-index-helpers.js'

export interface ExtractedBehavior {
  readonly testName: string
  readonly fullPath: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
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

export interface ConsolidatedBehavior {
  readonly id: string
  readonly domain: string
  readonly featureName: string
  readonly isUserFacing: boolean
  readonly behavior: string
  readonly userStory: string | null
  readonly context: string
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
}

const ConsolidatedBehaviorSchema = z.object({
  id: z.string(),
  domain: z.string(),
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceTestKeys: z.array(z.string()),
  sourceBehaviorIds: z.array(z.string()).default([]).readonly(),
  supportingInternalRefs: z
    .array(z.object({ behaviorId: z.string(), summary: z.string() }).readonly())
    .default([])
    .readonly(),
})

const ConsolidatedBehaviorArraySchema = z.array(ConsolidatedBehaviorSchema).readonly()

interface RebuildReportsInput {
  readonly manifest: IncrementalManifest
  readonly extractedBehaviorsByKey: Readonly<Record<string, ExtractedBehavior>>
  readonly evaluationsByKey: Readonly<Record<string, EvaluatedBehavior>>
  readonly consolidatedManifest: import('./incremental.js').ConsolidatedManifest | null
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
    lines.push(`**Context:** ${b.context}`)
    lines.push(`**Keywords:** ${b.keywords.join(', ')}\n`)
  }

  await Bun.write(outPath, lines.join('\n'))
}

export async function writeConsolidatedFile(
  domain: string,
  consolidations: readonly ConsolidatedBehavior[],
): Promise<void> {
  const outPath = join(CONSOLIDATED_DIR, `${domain}.json`)
  await mkdir(dirname(outPath), { recursive: true })
  const sorted = [...consolidations].toSorted((a, b) => a.id.localeCompare(b.id))
  await Bun.write(outPath, JSON.stringify(sorted, null, 2) + '\n')
}

export async function readConsolidatedFile(domain: string): Promise<readonly ConsolidatedBehavior[] | null> {
  const filePath = join(CONSOLIDATED_DIR, `${domain}.json`)
  try {
    await access(filePath, constants.F_OK)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }

  const text = await Bun.file(filePath).text()
  const raw: unknown = JSON.parse(text)
  return ConsolidatedBehaviorArraySchema.parse(raw)
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

function buildSummary(domain: string, evals: readonly EvaluatedBehavior[]): DomainSummary {
  const avg = (fn: (e: EvaluatedBehavior) => number): number => evals.reduce((s, e) => s + fn(e), 0) / evals.length
  const pAvg = (p: 'maria' | 'dani' | 'viktor'): number => avg((e) => (e[p].discover + e[p].use + e[p].retain) / 3)
  const personaScores: ReadonlyArray<readonly [string, number]> = [
    ['Maria', pAvg('maria')],
    ['Dani', pAvg('dani')],
    ['Viktor', pAvg('viktor')],
  ]
  const worst = personaScores.reduce((min, cur) => (cur[1] < min[1] ? cur : min))
  return {
    domain,
    count: evals.length,
    avgDiscover: avg((e) => (e.maria.discover + e.dani.discover + e.viktor.discover) / 3),
    avgUse: avg((e) => (e.maria.use + e.dani.use + e.viktor.use) / 3),
    avgRetain: avg((e) => (e.maria.retain + e.dani.retain + e.viktor.retain) / 3),
    worstPersona: `${worst[0]} (${worst[1].toFixed(1)})`,
  }
}

function countFrequency(items: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

function groupExtractedBehaviorsByFile(
  manifest: IncrementalManifest,
  extractedBehaviorsByKey: Readonly<Record<string, ExtractedBehavior>>,
): Readonly<Record<string, readonly ExtractedBehavior[]>> {
  const result: Record<string, ExtractedBehavior[]> = {}
  for (const [testKey, entry] of Object.entries(manifest.tests)) {
    const behavior = extractedBehaviorsByKey[testKey]
    if (behavior !== undefined) (result[entry.testFile] ??= []).push(behavior)
  }
  return result
}

function groupEvaluationsByDomain(
  manifest: IncrementalManifest,
  evaluationsByKey: Readonly<Record<string, EvaluatedBehavior>>,
): Readonly<Record<string, readonly EvaluatedBehavior[]>> {
  const result: Record<string, EvaluatedBehavior[]> = {}
  for (const [testKey, entry] of Object.entries(manifest.tests)) {
    const evaluation = evaluationsByKey[testKey]
    if (evaluation !== undefined) (result[entry.domain] ??= []).push(evaluation)
  }
  return result
}

async function writeRebuiltBehaviorFiles(
  extractedByFile: Readonly<Record<string, readonly ExtractedBehavior[]>>,
): Promise<void> {
  await Promise.all(
    Object.entries(extractedByFile).map(([testFile, behaviors]) =>
      writeBehaviorFile(
        testFile,
        [...behaviors].toSorted((a, b) => a.fullPath.localeCompare(b.fullPath)),
      ),
    ),
  )
}

async function writeRebuiltStoryFiles(
  evaluationsByDomain: Readonly<Record<string, readonly EvaluatedBehavior[]>>,
): Promise<void> {
  await Promise.all(
    Object.entries(evaluationsByDomain).map(([domain, evaluations]) =>
      writeStoryFile(
        domain,
        [...evaluations].toSorted((a, b) => a.testName.localeCompare(b.testName)),
      ),
    ),
  )
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

export async function rebuildReportsFromStoredResults({
  manifest,
  extractedBehaviorsByKey,
  evaluationsByKey,
  consolidatedManifest,
}: RebuildReportsInput): Promise<void> {
  const extractedByFile = groupExtractedBehaviorsByFile(manifest, extractedBehaviorsByKey)
  await writeRebuiltBehaviorFiles(extractedByFile)

  const evaluationsByDomain: Record<string, EvaluatedBehavior[]> = {}
  if (consolidatedManifest === null) {
    for (const [domain, evals] of Object.entries(groupEvaluationsByDomain(manifest, evaluationsByKey))) {
      evaluationsByDomain[domain] = [...evals]
    }
  } else {
    for (const [consolidatedId, entry] of Object.entries(consolidatedManifest.entries)) {
      const evaluation = evaluationsByKey[consolidatedId]
      if (evaluation !== undefined) (evaluationsByDomain[entry.domain] ??= []).push(evaluation)
    }
  }

  await writeRebuiltStoryFiles(evaluationsByDomain)

  const summaries = Object.entries(evaluationsByDomain)
    .map(([domain, evaluations]) => buildSummary(domain, evaluations))
    .toSorted((a, b) => a.domain.localeCompare(b.domain))

  const flawFrequency = countFrequency(Object.values(evaluationsByKey).flatMap((evaluation) => evaluation.flaws))
  const improvementFrequency = countFrequency(
    Object.values(evaluationsByKey).flatMap((evaluation) => evaluation.improvements),
  )

  await writeIndexFile(summaries, Object.keys(evaluationsByKey).length, 0, flawFrequency, improvementFrequency, [])
}
