import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import pLimit from 'p-limit'

import { BEHAVIORS_DIR, MAX_RETRIES } from './config.js'
import { getDomain } from './domain-map.js'
import { evaluateWithRetry } from './evaluate-agent.js'
import { recordEval, recordStoredEvaluation, writeReports } from './evaluate-reporting.js'
import type { IncrementalManifest } from './incremental.js'
import { buildPhase2Fingerprint, createEmptyManifest, loadManifest, saveManifest } from './incremental.js'
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

interface Phase2RunInput {
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
}

interface ParsedBehavior {
  readonly testFile: string
  readonly testName: string
  readonly behavior: string
  readonly context: string
  readonly domain: string
}

function readMatchedGroup(match: RegExpMatchArray | null, index: number, fallback: string): string {
  if (match === null) return fallback
  const value = match[index]
  if (value === undefined) return fallback
  return value
}

async function parseSingleFile(fullPath: string, behaviors: ParsedBehavior[]): Promise<void> {
  const content = await Bun.file(fullPath).text()
  const testFile = readMatchedGroup(content.match(/^# (.+)$/m), 1, 'unknown')
  const domain = getDomain(testFile)
  const sections = content.split(/^## Test: /m).slice(1)
  for (const section of sections) {
    const nameMatch = section.match(/^"(.+?)"/)
    const behaviorMatch = section.match(/\*\*Behavior:\*\* (.+?)(?=\n\*\*Context:|\n##|\n$)/s)
    const contextMatch = section.match(/\*\*Context:\*\* (.+?)(?=\n##|\n$)/s)
    if (nameMatch !== null && behaviorMatch !== null) {
      const context = contextMatch === null || contextMatch[1] === undefined ? '' : contextMatch[1].trim()
      behaviors.push({
        testFile,
        testName: nameMatch[1]!,
        behavior: behaviorMatch[1]!.trim(),
        context,
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

function updateManifestForEvaluatedBehavior(input: {
  readonly manifest: IncrementalManifest
  readonly behavior: ParsedBehavior
}): IncrementalManifest {
  const testKey = `${input.behavior.testFile}::${input.behavior.testName}`
  const previousEntry = input.manifest.tests[testKey]
  if (previousEntry === undefined) {
    return input.manifest
  }

  return {
    ...input.manifest,
    tests: {
      ...input.manifest.tests,
      [testKey]: {
        ...previousEntry,
        phase2Fingerprint: buildPhase2Fingerprint({
          testKey,
          behavior: input.behavior.behavior,
          context: input.behavior.context,
          phaseVersion: input.manifest.phaseVersions.phase2,
        }),
        lastPhase2CompletedAt: new Date().toISOString(),
      },
    },
  }
}

function resolveLoadedManifest(manifest: IncrementalManifest | null): IncrementalManifest {
  if (manifest === null) {
    return createEmptyManifest()
  }
  return manifest
}

function reuseStoredEvaluation(
  key: string,
  domain: string,
  progress: Progress,
  evalsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
): void {
  const existing = progress.phase2.evaluations[key]
  if (existing !== undefined) {
    recordStoredEvaluation(existing, domain, evalsByDomain, flawFreq, impFreq)
  }
}

function shouldSkipBehavior(
  key: string,
  idx: number,
  total: number,
  domain: string,
  testName: string,
  progress: Progress,
  evalsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
  selectedTestKeys: ReadonlySet<string>,
): boolean {
  if (!selectedTestKeys.has(key)) {
    reuseStoredEvaluation(key, domain, progress, evalsByDomain, flawFreq, impFreq)
    return true
  }
  if (isBehaviorCompleted(progress, key)) {
    reuseStoredEvaluation(key, domain, progress, evalsByDomain, flawFreq, impFreq)
    console.log(`  [${idx}/${total}] ${domain} :: "${testName}" (skipped)`)
    return true
  }
  if (getFailedBehaviorAttempts(progress, key) >= MAX_RETRIES) {
    console.log(`  [${idx}/${total}] ${domain} :: "${testName}" (max retries)`)
    return true
  }
  return false
}

async function evaluateSelectedBehavior(input: {
  readonly behavior: ParsedBehavior
  readonly key: string
  readonly idx: number
  readonly total: number
  readonly progress: Progress
  readonly evalsByDomain: Map<string, EvaluatedBehavior[]>
  readonly flawFreq: Map<string, number>
  readonly impFreq: Map<string, number>
  readonly manifest: IncrementalManifest
}): Promise<IncrementalManifest> {
  process.stdout.write(`  [${input.idx}/${input.total}] ${input.behavior.domain} :: "${input.behavior.testName}" `)
  const result = await evaluateWithRetry(buildPrompt(input.behavior))
  if (result === null) {
    markBehaviorFailed(input.progress, input.key, 'evaluation failed')
    return input.manifest
  }
  recordEval(
    result,
    {
      domain: input.behavior.domain,
      testName: input.behavior.testName,
      behavior: input.behavior.behavior,
    },
    input.evalsByDomain,
    input.flawFreq,
    input.impFreq,
  )
  markBehaviorDone(input.progress, input.key, {
    testName: input.behavior.testName,
    behavior: input.behavior.behavior,
    userStory: result.userStory,
    maria: result.maria,
    dani: result.dani,
    viktor: result.viktor,
    flaws: result.flaws,
    improvements: result.improvements,
  })
  await saveProgress(input.progress)
  const updatedManifest = updateManifestForEvaluatedBehavior({ manifest: input.manifest, behavior: input.behavior })
  await saveManifest(updatedManifest)
  return updatedManifest
}

function processSingleBehavior(
  b: ParsedBehavior,
  idx: number,
  total: number,
  progress: Progress,
  evalsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
  selectedTestKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
): Promise<IncrementalManifest> {
  const key = `${b.testFile}::${b.testName}`
  if (
    shouldSkipBehavior(
      key,
      idx,
      total,
      b.domain,
      b.testName,
      progress,
      evalsByDomain,
      flawFreq,
      impFreq,
      selectedTestKeys,
    )
  ) {
    return Promise.resolve(manifest)
  }
  return evaluateSelectedBehavior({
    behavior: b,
    key,
    idx,
    total,
    progress,
    evalsByDomain,
    flawFreq,
    impFreq,
    manifest,
  })
}

export async function runPhase2({ progress, selectedTestKeys }: Phase2RunInput): Promise<void> {
  console.log('\n[Phase 2] Parsing behavior files...')
  const allBehaviors = await parseBehaviorFiles()
  const manifest = resolveLoadedManifest(await loadManifest())
  progress.phase2.status = 'in-progress'
  progress.phase2.stats.behaviorsTotal = allBehaviors.length
  await saveProgress(progress)
  console.log(`[Phase 2] Evaluating ${allBehaviors.length} behaviors...\n`)

  const evalsByDomain = new Map<string, EvaluatedBehavior[]>()
  const flawFreq = new Map<string, number>()
  const impFreq = new Map<string, number>()
  const limit = pLimit(1)
  let currentManifest = manifest

  await Promise.all(
    allBehaviors.map((b, i) =>
      limit(async () => {
        currentManifest = await processSingleBehavior(
          b,
          i + 1,
          allBehaviors.length,
          progress,
          evalsByDomain,
          flawFreq,
          impFreq,
          selectedTestKeys,
          currentManifest,
        )
      }),
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
