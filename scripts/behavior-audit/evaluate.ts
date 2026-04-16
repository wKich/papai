import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import pLimit from 'p-limit'

import { BEHAVIORS_DIR, MAX_RETRIES } from './config.js'
import { getDomain } from './domain-map.js'
import { evaluateWithRetry } from './evaluate-agent.js'
import { ALL_PERSONAS } from './personas.js'
import type { Progress } from './progress.js'
import {
  getFailedBehaviorAttempts,
  isBehaviorCompleted,
  markBehaviorDone,
  markBehaviorFailed,
  saveProgress,
} from './progress.js'
import type { EvaluatedBehavior } from './report-writer.js'
import { writeIndexFile, writeStoryFile } from './report-writer.js'

interface ParsedBehavior {
  readonly testFile: string
  readonly testName: string
  readonly behavior: string
  readonly context: string
  readonly domain: string
}

async function parseSingleFile(fullPath: string, behaviors: ParsedBehavior[]): Promise<void> {
  const content = await Bun.file(fullPath).text()
  const testFile = content.match(/^# (.+)$/m)?.[1] ?? 'unknown'
  const domain = getDomain(testFile)
  const sections = content.split(/^## Test: /m).slice(1)
  for (const section of sections) {
    const nameMatch = section.match(/^"(.+?)"/)
    const behaviorMatch = section.match(/\*\*Behavior:\*\* (.+?)(?=\n\*\*Context:|\n##|\n$)/s)
    const contextMatch = section.match(/\*\*Context:\*\* (.+?)(?=\n##|\n$)/s)
    if (nameMatch !== null && behaviorMatch !== null) {
      behaviors.push({
        testFile,
        testName: nameMatch[1]!,
        behavior: behaviorMatch[1]!.trim(),
        context: contextMatch?.[1]?.trim() ?? '',
        domain,
      })
    }
  }
}

async function parseBehaviorFiles(): Promise<readonly ParsedBehavior[]> {
  const behaviors: ParsedBehavior[] = []
  async function walkDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    const subdirs: string[] = []
    const files: string[] = []
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) subdirs.push(fullPath)
      else if (entry.name.endsWith('.behaviors.md')) files.push(fullPath)
    }
    await Promise.all([...files.map((f) => parseSingleFile(f, behaviors)), ...subdirs.map((d) => walkDir(d))])
  }
  await walkDir(BEHAVIORS_DIR)
  return behaviors
}

function buildPrompt(b: ParsedBehavior): string {
  return `${ALL_PERSONAS}\n\n---\n\n**Domain:** ${b.domain}\n**Test file:** ${b.testFile}\n**Test name:** ${b.testName}\n\n**Behavior:** ${b.behavior}\n\n**Context:** ${b.context}`
}

function recordEval(
  evalResult: import('./evaluate-agent.js').EvalResult,
  b: ParsedBehavior,
  evaluationsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
): void {
  const evaluated: EvaluatedBehavior = {
    testName: b.testName,
    behavior: b.behavior,
    userStory: evalResult.userStory,
    maria: evalResult.maria,
    dani: evalResult.dani,
    viktor: evalResult.viktor,
    flaws: evalResult.flaws,
    improvements: evalResult.improvements,
  }
  evaluationsByDomain.set(b.domain, [...(evaluationsByDomain.get(b.domain) ?? []), evaluated])
  for (const flaw of evalResult.flaws) flawFreq.set(flaw, (flawFreq.get(flaw) ?? 0) + 1)
  for (const imp of evalResult.improvements) impFreq.set(imp, (impFreq.get(imp) ?? 0) + 1)
}

function buildSummary(
  domain: string,
  evals: readonly EvaluatedBehavior[],
): {
  readonly domain: string
  readonly count: number
  readonly avgDiscover: number
  readonly avgUse: number
  readonly avgRetain: number
  readonly worstPersona: string
} {
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

async function writeReports(
  evaluationsByDomain: ReadonlyMap<string, EvaluatedBehavior[]>,
  flawFreq: ReadonlyMap<string, number>,
  impFreq: ReadonlyMap<string, number>,
  progress: Progress,
): Promise<void> {
  await Promise.all([...evaluationsByDomain.entries()].map(([d, ev]) => writeStoryFile(d, ev)))
  const summaries = [...evaluationsByDomain.entries()].map(([d, ev]) => buildSummary(d, ev))
  const failedItems = Object.entries(progress.phase2.failedBehaviors).map(([key, entry]) => {
    const parts = key.split('::')
    return {
      testFile: parts[0] ?? 'unknown',
      testName: parts.slice(1).join('::'),
      error: entry.error,
      attempts: entry.attempts,
    }
  })
  await writeIndexFile(
    summaries,
    progress.phase2.stats.behaviorsDone,
    progress.phase2.stats.behaviorsFailed,
    flawFreq,
    impFreq,
    failedItems,
  )
}

async function processSingleBehavior(
  b: ParsedBehavior,
  idx: number,
  total: number,
  progress: Progress,
  evalsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
): Promise<void> {
  const key = `${b.testFile}::${b.testName}`
  if (isBehaviorCompleted(progress, key)) {
    console.log(`  [${idx}/${total}] ${b.domain} :: "${b.testName}" (skipped)`)
    return
  }
  if (getFailedBehaviorAttempts(progress, key) >= MAX_RETRIES) {
    console.log(`  [${idx}/${total}] ${b.domain} :: "${b.testName}" (max retries)`)
    return
  }
  process.stdout.write(`  [${idx}/${total}] ${b.domain} :: "${b.testName}" `)
  const result = await evaluateWithRetry(buildPrompt(b))
  if (result === null) {
    markBehaviorFailed(progress, key, 'evaluation failed')
    return
  }
  recordEval(result, b, evalsByDomain, flawFreq, impFreq)
  markBehaviorDone(progress, key)
  if (idx % 10 === 0) await saveProgress(progress)
}

export async function runPhase2(progress: Progress): Promise<void> {
  console.log('\n[Phase 2] Parsing behavior files...')
  const allBehaviors = await parseBehaviorFiles()
  progress.phase2.status = 'in-progress'
  progress.phase2.stats.behaviorsTotal = allBehaviors.length
  await saveProgress(progress)
  console.log(`[Phase 2] Evaluating ${allBehaviors.length} behaviors...\n`)

  const evalsByDomain = new Map<string, EvaluatedBehavior[]>()
  const flawFreq = new Map<string, number>()
  const impFreq = new Map<string, number>()
  const limit = pLimit(1)

  await Promise.all(
    allBehaviors.map((b, i) =>
      limit(() => processSingleBehavior(b, i + 1, allBehaviors.length, progress, evalsByDomain, flawFreq, impFreq)),
    ),
  )

  await writeReports(evalsByDomain, flawFreq, impFreq, progress)
  progress.phase2.status = 'done'
  await saveProgress(progress)
  console.log(
    `\n[Phase 2 complete] ${progress.phase2.stats.behaviorsDone} evaluated, ${progress.phase2.stats.behaviorsFailed} failed`,
  )
  console.log('→ reports/stories/index.md written')
}
