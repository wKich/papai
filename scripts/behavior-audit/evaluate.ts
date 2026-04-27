import pLimit from 'p-limit'

import { formatElapsedMs } from './config.js'
import { evaluateWithRetry } from './evaluate-agent.js'
import {
  getFeatureKeys,
  mergeEvaluations,
  parseBehaviors,
  resolveSelection,
  shouldSkip,
  toReportMaps,
  type ParsedBehavior,
  type StoredFeatureData,
  updateManifest,
} from './evaluate-phase3-helpers.js'
import { writeReports } from './evaluate-reporting.js'
import type { EvaluatedFeatureRecord } from './evaluated-store.js'
import { readEvaluatedFile, writeEvaluatedFile } from './evaluated-store.js'
import type { ConsolidatedManifest } from './incremental.js'
import { saveConsolidatedManifest } from './incremental.js'
import { ALL_PERSONAS } from './personas.js'
import {
  type PhaseStats,
  createPhaseStats,
  formatPerItemSuffix,
  formatPhaseSummary,
  recordItemDone,
  recordItemFailed,
} from './phase-stats.js'
import { saveProgress } from './progress-io.js'
import type { Progress } from './progress.js'
import { getFailedBehaviorAttempts, isBehaviorCompleted, markBehaviorDone, markBehaviorFailed } from './progress.js'
import { readConsolidatedFile } from './report-writer.js'

interface Phase3RunInput {
  readonly progress: Progress
  readonly selectedConsolidatedIds: ReadonlySet<string>
  readonly selectedFeatureKeys?: ReadonlySet<string>
  readonly consolidatedManifest: ConsolidatedManifest | null
}

export interface Phase3Deps {
  readonly evaluateWithRetry: typeof evaluateWithRetry
  readonly readConsolidatedFile: typeof readConsolidatedFile
  readonly readEvaluatedFile: typeof readEvaluatedFile
  readonly writeEvaluatedFile: typeof writeEvaluatedFile
  readonly getFailedBehaviorAttempts: typeof getFailedBehaviorAttempts
  readonly isBehaviorCompleted: typeof isBehaviorCompleted
  readonly markBehaviorDone: typeof markBehaviorDone
  readonly markBehaviorFailed: typeof markBehaviorFailed
  readonly saveProgress: typeof saveProgress
  readonly writeReports: typeof writeReports
  readonly log: Pick<typeof console, 'log'>
  readonly writeStdout: (text: string) => void
  readonly stats?: PhaseStats
}

const defaultPhase3Deps: Phase3Deps = {
  evaluateWithRetry,
  readConsolidatedFile,
  readEvaluatedFile,
  writeEvaluatedFile,
  getFailedBehaviorAttempts,
  isBehaviorCompleted,
  markBehaviorDone,
  markBehaviorFailed,
  saveProgress,
  writeReports,
  log: console,
  writeStdout: (text) => {
    process.stdout.write(text)
  },
}

function buildPrompt(behavior: ParsedBehavior): string {
  return `${ALL_PERSONAS}\n\n---\n\n**Domain:** ${behavior.domain}\n**Feature:** ${behavior.featureName}\n**User Story:** ${behavior.userStory}\n\n**Behavior:** ${behavior.behavior}\n\n**Context:** ${behavior.context}`
}

async function loadStoredFeatureData(
  manifest: ConsolidatedManifest,
  deps: Phase3Deps,
): Promise<ReadonlyMap<string, StoredFeatureData>> {
  const featureKeys = getFeatureKeys(manifest)
  const loaded = await Promise.all(
    featureKeys.map(
      async (featureKey) =>
        [
          featureKey,
          {
            consolidated: (await deps.readConsolidatedFile(featureKey)) ?? [],
            evaluated: (await deps.readEvaluatedFile(featureKey)) ?? [],
          },
        ] as const,
    ),
  )
  return new Map(loaded)
}

async function evaluateBehavior(input: {
  readonly behavior: ParsedBehavior
  readonly idx: number
  readonly total: number
  readonly progress: Progress
  readonly deps: Phase3Deps
}): Promise<EvaluatedFeatureRecord | null> {
  input.deps.writeStdout(`  [${input.idx}/${input.total}] ${input.behavior.domain} :: "${input.behavior.featureName}" `)
  const startMs = performance.now()
  const agentResult = await input.deps.evaluateWithRetry(buildPrompt(input.behavior))
  const elapsedMs = performance.now() - startMs
  if (agentResult === null) {
    input.deps.markBehaviorFailed(input.progress, input.behavior.consolidatedId, 'evaluation failed after retries', 1)
    input.deps.log.log(`(${formatElapsedMs(elapsedMs)}) ✗`)
    if (input.deps.stats !== undefined) recordItemFailed(input.deps.stats)
    return null
  }

  input.deps.markBehaviorDone(input.progress, input.behavior.consolidatedId)
  await input.deps.saveProgress(input.progress)
  input.deps.log.log(formatPerItemSuffix(agentResult.usage, elapsedMs))
  if (input.deps.stats !== undefined) recordItemDone(input.deps.stats, agentResult.usage)
  return {
    consolidatedId: input.behavior.consolidatedId,
    maria: agentResult.result.maria,
    dani: agentResult.result.dani,
    viktor: agentResult.result.viktor,
    flaws: agentResult.result.flaws,
    improvements: agentResult.result.improvements,
    evaluatedAt: new Date().toISOString(),
  }
}

async function collectNewEvaluations(input: {
  readonly behaviors: readonly ParsedBehavior[]
  readonly selection: ReturnType<typeof resolveSelection>
  readonly progress: Progress
  readonly deps: Phase3Deps
}): Promise<ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>> {
  const collected = new Map<string, EvaluatedFeatureRecord[]>()
  const limit = pLimit(1)
  await Promise.all(
    input.behaviors.map((behavior, index) =>
      limit(async () => {
        if (shouldSkip(behavior, input.selection, input.progress, input.deps)) return
        const evaluation = await evaluateBehavior({
          behavior,
          idx: index + 1,
          total: input.behaviors.length,
          progress: input.progress,
          deps: input.deps,
        })
        if (evaluation === null) return
        collected.set(behavior.featureKey, [...(collected.get(behavior.featureKey) ?? []), evaluation])
      }),
    ),
  )
  return collected
}

async function persistEvaluations(
  collected: ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>,
  storedByFeatureKey: ReadonlyMap<string, StoredFeatureData>,
  deps: Phase3Deps,
): Promise<void> {
  await Promise.all(
    [...collected.entries()].map(([featureKey, records]) =>
      deps.writeEvaluatedFile(
        featureKey,
        mergeEvaluations(storedByFeatureKey.get(featureKey)?.evaluated ?? [], records),
      ),
    ),
  )
}

export async function runPhase3(
  { progress, selectedConsolidatedIds, selectedFeatureKeys = new Set(), consolidatedManifest }: Phase3RunInput,
  deps: Partial<Phase3Deps> = {},
): Promise<ConsolidatedManifest | null> {
  if (consolidatedManifest === null) return null
  const resolvedDeps: Phase3Deps = { ...defaultPhase3Deps, ...deps }
  const stats = resolvedDeps.stats ?? createPhaseStats()
  let storedByFeatureKey = await loadStoredFeatureData(consolidatedManifest, { ...resolvedDeps, stats })
  const behaviors = parseBehaviors(consolidatedManifest, storedByFeatureKey)
  progress.phase3.status = 'in-progress'
  progress.phase3.stats.consolidatedIdsTotal = behaviors.length
  await resolvedDeps.saveProgress(progress)
  const collected = await collectNewEvaluations({
    behaviors,
    selection: resolveSelection(selectedConsolidatedIds, selectedFeatureKeys, behaviors),
    progress,
    deps: { ...resolvedDeps, stats },
  })
  await persistEvaluations(collected, storedByFeatureKey, { ...resolvedDeps, stats })
  storedByFeatureKey = await loadStoredFeatureData(consolidatedManifest, { ...resolvedDeps, stats })
  const updatedManifest = updateManifest(consolidatedManifest, storedByFeatureKey)
  await saveConsolidatedManifest(updatedManifest)
  await resolvedDeps.writeReports({
    ...toReportMaps(storedByFeatureKey),
    progress,
  })
  progress.phase3.status = 'done'
  await resolvedDeps.saveProgress(progress)
  const wallMs = performance.now() - stats.wallStartMs
  const label = `[Phase 3 complete] ${progress.phase3.stats.consolidatedIdsDone} evaluated, ${progress.phase3.stats.consolidatedIdsFailed} failed`
  resolvedDeps.log.log(`\n${formatPhaseSummary(stats, wallMs, label)}`)
  return updatedManifest
}
