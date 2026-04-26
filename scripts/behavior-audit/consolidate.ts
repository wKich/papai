import pLimit from 'p-limit'

import { readClassifiedFile } from './classified-store.js'
import { MAX_RETRIES, formatElapsedMs } from './config.js'
import type { ConsolidateBehaviorInput } from './consolidate-agent.js'
import {
  loadGroupedInputs,
  toConsolidations,
  updateManifestEntries,
  type ConsolidateWithRetry,
} from './consolidate-helpers.js'
import { readExtractedFile } from './extracted-store.js'
import type { ConsolidatedManifest, IncrementalManifest } from './incremental.js'
import {
  type PhaseStats,
  createPhaseStats,
  formatPerItemSuffix,
  formatPhaseSummary,
  recordItemDone,
  recordItemFailed,
  recordItemSkipped,
} from './phase-stats.js'
import type { AgentUsage } from './phase-stats.js'
import {
  getFailedFeatureKeyAttempts,
  markFeatureKeyDone,
  markFeatureKeyFailed,
  resetPhase3,
  saveProgress,
} from './progress.js'
import type { Progress } from './progress.js'
import { writeConsolidatedFile } from './report-writer.js'

type ConsolidationProcessResult =
  | { readonly kind: 'consolidated'; readonly manifest: ConsolidatedManifest; readonly usage: AgentUsage }
  | { readonly kind: 'failed'; readonly manifest: ConsolidatedManifest }
  | { readonly kind: 'skipped'; readonly manifest: ConsolidatedManifest }

interface Phase2bDeps {
  readonly consolidateWithRetry: ConsolidateWithRetry
  readonly writeConsolidatedFile: typeof writeConsolidatedFile
  readonly readExtractedFile: typeof readExtractedFile
  readonly readClassifiedFile: typeof readClassifiedFile
  readonly log: Pick<typeof console, 'log'>
  readonly writeStdout: (text: string) => void
  readonly stats?: PhaseStats
}

const defaultConsolidateWithRetry: ConsolidateWithRetry = async (...args) => {
  const { consolidateWithRetry } = await import('./consolidate-agent.js')
  return consolidateWithRetry(...args)
}

const defaultPhase2bDeps: Phase2bDeps = {
  consolidateWithRetry: defaultConsolidateWithRetry,
  writeConsolidatedFile,
  readExtractedFile,
  readClassifiedFile,
  log: console,
  writeStdout: (text) => {
    process.stdout.write(text)
  },
}

async function consolidateFeatureKey(input: {
  readonly progress: Progress
  readonly consolidatedManifest: ConsolidatedManifest
  readonly phase2Version: string
  readonly featureKey: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
  readonly deps: Phase2bDeps
}): Promise<ConsolidationProcessResult> {
  const failedAttempts = getFailedFeatureKeyAttempts(input.progress, input.featureKey)
  if (failedAttempts >= MAX_RETRIES) {
    return { kind: 'skipped', manifest: input.consolidatedManifest }
  }

  const agentResult = await input.deps.consolidateWithRetry(input.featureKey, input.inputs, failedAttempts)
  if (agentResult === null) {
    markFeatureKeyFailed(input.progress, input.featureKey, 'consolidation failed after retries', failedAttempts + 1)
    await saveProgress(input.progress)
    return { kind: 'failed', manifest: input.consolidatedManifest }
  }

  const consolidations = toConsolidations(agentResult.result, input.inputs)
  await input.deps.writeConsolidatedFile(input.featureKey, consolidations)
  markFeatureKeyDone(input.progress, input.featureKey, consolidations)
  await saveProgress(input.progress)

  return {
    kind: 'consolidated',
    manifest: {
      ...input.consolidatedManifest,
      entries: updateManifestEntries({
        currentEntries: input.consolidatedManifest.entries,
        featureKey: input.featureKey,
        inputs: input.inputs,
        consolidations,
        phase2Version: input.phase2Version,
      }),
    },
    usage: agentResult.usage,
  }
}

function logConsolidationResult(deps: Phase2bDeps, result: ConsolidationProcessResult, elapsedMs: number): void {
  switch (result.kind) {
    case 'consolidated':
      deps.log.log(formatPerItemSuffix(result.usage, elapsedMs))
      break
    case 'failed':
      deps.log.log(`(${formatElapsedMs(elapsedMs)}) ✗`)
      break
    case 'skipped':
      deps.log.log('(skipped)')
      break
  }
}

async function processFeatureKeyGroup(
  featureKey: string,
  inputs: readonly ConsolidateBehaviorInput[],
  displayIndex: number,
  displayTotal: number,
  progress: Progress,
  currentManifest: ConsolidatedManifest,
  phase2Version: string,
  deps: Phase2bDeps,
): Promise<ConsolidationProcessResult> {
  deps.writeStdout(`  [${displayIndex}/${displayTotal}] "${featureKey}" `)
  const startMs = performance.now()
  const result = await consolidateFeatureKey({
    progress,
    consolidatedManifest: currentManifest,
    phase2Version,
    featureKey,
    inputs,
    deps,
  })
  const elapsedMs = performance.now() - startMs
  logConsolidationResult(deps, result, elapsedMs)
  if (deps.stats !== undefined) {
    if (result.kind === 'consolidated') {
      recordItemDone(deps.stats, result.usage)
    } else if (result.kind === 'failed') {
      recordItemFailed(deps.stats)
    } else {
      recordItemSkipped(deps.stats)
    }
  }
  return result
}

export async function runPhase2b(
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
  selectedFeatureKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
  deps: Partial<Phase2bDeps> = {},
): Promise<ConsolidatedManifest> {
  const stats = deps.stats ?? createPhaseStats()
  const resolvedDeps: Phase2bDeps = { ...defaultPhase2bDeps, ...deps, stats }
  const groups = [...(await loadGroupedInputs(manifest, selectedFeatureKeys, resolvedDeps)).entries()]
  progress.phase2b.status = 'in-progress'
  progress.phase2b.stats.featureKeysTotal = groups.length
  resetPhase3(progress)
  await saveProgress(progress)

  const limit = pLimit(1)
  let currentManifest = consolidatedManifest
  await Promise.all(
    groups.map(([featureKey, inputs], index) =>
      limit(async () => {
        const result = await processFeatureKeyGroup(
          featureKey,
          inputs,
          index + 1,
          groups.length,
          progress,
          currentManifest,
          phase2Version,
          resolvedDeps,
        )
        currentManifest = result.manifest
      }),
    ),
  )

  progress.phase2b.status = 'done'
  await saveProgress(progress)
  const wallMs = performance.now() - stats.wallStartMs
  const label = `[Phase 2b complete] ${progress.phase2b.stats.featureKeysDone} feature keys consolidated, ${progress.phase2b.stats.featureKeysFailed} failed`
  resolvedDeps.log.log(`\n${formatPhaseSummary(stats, wallMs, label)}`)
  return currentManifest
}
