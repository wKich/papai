import pLimit from 'p-limit'

import { MAX_RETRIES } from './config.js'
import { evaluateWithRetry } from './evaluate-agent.js'
import { recordEval, recordStoredEvaluation, writeReports } from './evaluate-reporting.js'
import type { ConsolidatedManifest } from './incremental.js'
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
import { readConsolidatedFile } from './report-writer.js'

interface Phase3RunInput {
  readonly progress: Progress
  readonly selectedConsolidatedIds: ReadonlySet<string>
  readonly consolidatedManifest: ConsolidatedManifest | null
}

interface Phase3Selection {
  readonly ids: ReadonlySet<string>
  readonly evaluateAll: boolean
}

export interface Phase3Deps {
  readonly evaluateWithRetry: typeof evaluateWithRetry
  readonly readConsolidatedFile: typeof readConsolidatedFile
  readonly getFailedBehaviorAttempts: typeof getFailedBehaviorAttempts
  readonly isBehaviorCompleted: typeof isBehaviorCompleted
  readonly markBehaviorDone: typeof markBehaviorDone
  readonly markBehaviorFailed: typeof markBehaviorFailed
  readonly saveProgress: typeof saveProgress
  readonly recordEval: typeof recordEval
  readonly recordStoredEvaluation: typeof recordStoredEvaluation
  readonly writeReports: typeof writeReports
  readonly log: Pick<typeof console, 'log'>
  readonly writeStdout: (text: string) => void
}

const defaultPhase3Deps: Phase3Deps = {
  evaluateWithRetry,
  readConsolidatedFile,
  getFailedBehaviorAttempts,
  isBehaviorCompleted,
  markBehaviorDone,
  markBehaviorFailed,
  saveProgress,
  recordEval,
  recordStoredEvaluation,
  writeReports,
  log: console,
  writeStdout: (text) => {
    process.stdout.write(text)
  },
}

function getConsolidatedFileKeysFromManifestEntries(
  entries: Readonly<Record<string, import('./incremental.js').ConsolidatedManifestEntry>>,
): readonly string[] {
  return [...new Set(Object.values(entries).map((entry) => entry.candidateFeatureKey ?? entry.domain))].toSorted()
}

interface ParsedConsolidatedBehavior {
  readonly consolidatedId: string
  readonly domain: string
  readonly featureName: string
  readonly behavior: string
  readonly userStory: string
  readonly context: string
}

async function parseConsolidatedFiles(
  fileKeys: readonly string[],
  deps: Phase3Deps,
): Promise<readonly ParsedConsolidatedBehavior[]> {
  const results = await Promise.all(fileKeys.map((fileKey) => deps.readConsolidatedFile(fileKey)))
  const behaviors: ParsedConsolidatedBehavior[] = []
  for (const consolidated of results) {
    if (consolidated === null) continue
    for (const item of consolidated) {
      if (!item.isUserFacing || item.userStory === null) continue
      behaviors.push({
        consolidatedId: item.id,
        domain: item.domain,
        featureName: item.featureName,
        behavior: item.behavior,
        userStory: item.userStory,
        context: item.context,
      })
    }
  }
  return behaviors
}

function buildPrompt(b: ParsedConsolidatedBehavior): string {
  return `${ALL_PERSONAS}\n\n---\n\n**Domain:** ${b.domain}\n**Feature:** ${b.featureName}\n**User Story:** ${b.userStory}\n\n**Behavior:** ${b.behavior}\n\n**Context:** ${b.context}`
}

function resolvePhase3Selection(
  selectedConsolidatedIds: ReadonlySet<string>,
  allBehaviors: readonly ParsedConsolidatedBehavior[],
): Phase3Selection {
  if (selectedConsolidatedIds.size === 0) {
    return { ids: selectedConsolidatedIds, evaluateAll: true }
  }

  const availableIds = new Set(allBehaviors.map((behavior) => behavior.consolidatedId))
  const hasOverlap = [...selectedConsolidatedIds].some((id) => availableIds.has(id))
  if (!hasOverlap) {
    return { ids: availableIds, evaluateAll: true }
  }

  return { ids: selectedConsolidatedIds, evaluateAll: false }
}

function reuseStoredEvaluation(
  key: string,
  domain: string,
  progress: Progress,
  evalsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
  deps: Phase3Deps,
): void {
  const existing = progress.phase3.evaluations[key]
  if (existing !== undefined) {
    deps.recordStoredEvaluation(existing, domain, evalsByDomain, flawFreq, impFreq)
  }
}

function shouldSkipBehavior(
  key: string,
  idx: number,
  total: number,
  domain: string,
  featureName: string,
  progress: Progress,
  evalsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
  selection: Phase3Selection,
  deps: Phase3Deps,
): boolean {
  if (!selection.evaluateAll && !selection.ids.has(key)) {
    reuseStoredEvaluation(key, domain, progress, evalsByDomain, flawFreq, impFreq, deps)
    return true
  }
  if (deps.isBehaviorCompleted(progress, key) && !selection.ids.has(key)) {
    reuseStoredEvaluation(key, domain, progress, evalsByDomain, flawFreq, impFreq, deps)
    deps.log.log(`  [${idx}/${total}] ${domain} :: "${featureName}" (skipped)`)
    return true
  }
  if (deps.getFailedBehaviorAttempts(progress, key) >= MAX_RETRIES) {
    deps.log.log(`  [${idx}/${total}] ${domain} :: "${featureName}" (max retries)`)
    return true
  }
  return false
}

async function evaluateSelectedBehavior(input: {
  readonly behavior: ParsedConsolidatedBehavior
  readonly key: string
  readonly idx: number
  readonly total: number
  readonly progress: Progress
  readonly evalsByDomain: Map<string, EvaluatedBehavior[]>
  readonly flawFreq: Map<string, number>
  readonly impFreq: Map<string, number>
  readonly deps: Phase3Deps
}): Promise<void> {
  input.deps.writeStdout(`  [${input.idx}/${input.total}] ${input.behavior.domain} :: "${input.behavior.featureName}" `)
  const result = await input.deps.evaluateWithRetry(buildPrompt(input.behavior))
  if (result === null) {
    input.deps.markBehaviorFailed(input.progress, input.key, 'evaluation failed after retries', 1)
    return
  }
  input.deps.recordEval(
    result,
    {
      domain: input.behavior.domain,
      featureName: input.behavior.featureName,
      behavior: input.behavior.behavior,
      userStory: input.behavior.userStory,
    },
    input.evalsByDomain,
    input.flawFreq,
    input.impFreq,
  )
  input.deps.markBehaviorDone(input.progress, input.key, {
    testName: input.behavior.featureName,
    behavior: input.behavior.behavior,
    userStory: input.behavior.userStory,
    maria: result.maria,
    dani: result.dani,
    viktor: result.viktor,
    flaws: result.flaws,
    improvements: result.improvements,
  })
  await input.deps.saveProgress(input.progress)
}

function processSingleBehavior(
  b: ParsedConsolidatedBehavior,
  idx: number,
  total: number,
  progress: Progress,
  evalsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
  selection: Phase3Selection,
  deps: Phase3Deps,
): Promise<void> {
  const key = b.consolidatedId
  if (
    shouldSkipBehavior(
      key,
      idx,
      total,
      b.domain,
      b.featureName,
      progress,
      evalsByDomain,
      flawFreq,
      impFreq,
      selection,
      deps,
    )
  ) {
    return Promise.resolve()
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
    deps,
  })
}

export async function runPhase3(
  { progress, selectedConsolidatedIds, consolidatedManifest }: Phase3RunInput,
  deps: Partial<Phase3Deps> = {},
): Promise<void> {
  const resolvedDeps: Phase3Deps = { ...defaultPhase3Deps, ...deps }
  resolvedDeps.log.log('\n[Phase 3] Reading consolidated behavior files...')
  const fileKeys =
    consolidatedManifest === null ? [] : getConsolidatedFileKeysFromManifestEntries(consolidatedManifest.entries)
  const allBehaviors = await parseConsolidatedFiles(fileKeys, resolvedDeps)
  const selection = resolvePhase3Selection(selectedConsolidatedIds, allBehaviors)
  progress.phase3.status = 'in-progress'
  progress.phase3.stats.behaviorsTotal = allBehaviors.length
  await resolvedDeps.saveProgress(progress)
  resolvedDeps.log.log(`[Phase 3] Scoring ${allBehaviors.length} user-facing behaviors...\n`)

  const evalsByDomain = new Map<string, EvaluatedBehavior[]>()
  const flawFreq = new Map<string, number>()
  const impFreq = new Map<string, number>()
  const limit = pLimit(1)

  await Promise.all(
    allBehaviors.map((b, i) =>
      limit(() =>
        processSingleBehavior(
          b,
          i + 1,
          allBehaviors.length,
          progress,
          evalsByDomain,
          flawFreq,
          impFreq,
          selection,
          resolvedDeps,
        ),
      ),
    ),
  )

  await resolvedDeps.writeReports(evalsByDomain, flawFreq, impFreq, progress)
  progress.phase3.status = 'done'
  await resolvedDeps.saveProgress(progress)
  resolvedDeps.log.log(
    `\n[Phase 3 complete] ${progress.phase3.stats.behaviorsDone} evaluated, ${progress.phase3.stats.behaviorsFailed} failed`,
  )
  resolvedDeps.log.log('→ reports/stories/index.md written')
}
