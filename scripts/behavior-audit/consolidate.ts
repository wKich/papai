import pLimit from 'p-limit'

import type { ClassifiedBehavior } from './classified-store.js'
import { MAX_RETRIES } from './config.js'
import type { ConsolidateBehaviorInput } from './consolidate-agent.js'
import { consolidateWithRetry } from './consolidate-agent.js'
import type { ConsolidatedManifest } from './incremental.js'
import { buildPhase2ConsolidationFingerprint } from './incremental.js'
import type { Progress } from './progress.js'
import { getFailedBatchAttempts, markBatchDone, markBatchFailed, resetPhase3, saveProgress } from './progress.js'
import type { ConsolidatedBehavior } from './report-writer.js'
import { writeConsolidatedFile } from './report-writer.js'

function groupByCandidateFeature(
  classified: Readonly<Record<string, ClassifiedBehavior>>,
  selectedCandidateFeatureKeys: ReadonlySet<string>,
): ReadonlyMap<string, readonly ConsolidateBehaviorInput[]> {
  const grouped = new Map<string, ConsolidateBehaviorInput[]>()
  for (const item of Object.values(classified)) {
    if (item.candidateFeatureKey === null) continue
    if (selectedCandidateFeatureKeys.size > 0 && !selectedCandidateFeatureKeys.has(item.candidateFeatureKey)) continue
    grouped.set(item.candidateFeatureKey, [
      ...(grouped.get(item.candidateFeatureKey) ?? []),
      {
        behaviorId: item.behaviorId,
        testKey: item.testKey,
        domain: item.domain,
        visibility: item.visibility,
        candidateFeatureKey: item.candidateFeatureKey,
        candidateFeatureLabel: item.candidateFeatureLabel,
        behavior: item.behavior,
        context: item.context,
        keywords: item.keywords,
      },
    ])
  }
  return grouped
}

function buildConsolidatedDomain(inputs: readonly ConsolidateBehaviorInput[]): string {
  const domains = [...new Set(inputs.map((input) => input.domain))].toSorted()
  return domains.length === 1 ? (domains[0] ?? 'unknown') : 'cross-domain'
}

function toConsolidations(
  result: NonNullable<Awaited<ReturnType<typeof consolidateWithRetry>>>,
  inputs: readonly ConsolidateBehaviorInput[],
): readonly ConsolidatedBehavior[] {
  const domain = buildConsolidatedDomain(inputs)
  return result.map(({ id, item }) => ({
    id,
    domain,
    featureName: item.featureName,
    isUserFacing: item.isUserFacing,
    behavior: item.behavior,
    userStory: item.userStory,
    context: item.context,
    sourceTestKeys: item.sourceTestKeys,
    sourceBehaviorIds: item.sourceBehaviorIds,
    supportingInternalRefs: item.supportingInternalRefs,
  }))
}

function updateManifestEntries(input: {
  readonly currentEntries: ConsolidatedManifest['entries']
  readonly candidateFeatureKey: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
  readonly consolidations: readonly ConsolidatedBehavior[]
  readonly phase2Version: string
}): ConsolidatedManifest['entries'] {
  const keywords = [...new Set(input.inputs.flatMap((item) => item.keywords))].toSorted()
  const sourceDomains = [...new Set(input.inputs.map((item) => item.domain))].toSorted()
  return input.consolidations.reduce(
    (entries, consolidated) => ({
      ...entries,
      [consolidated.id]: {
        consolidatedId: consolidated.id,
        domain: consolidated.domain,
        featureName: consolidated.featureName,
        sourceTestKeys: consolidated.sourceTestKeys,
        sourceBehaviorIds: consolidated.sourceBehaviorIds,
        supportingInternalBehaviorIds: consolidated.supportingInternalRefs.map((item) => item.behaviorId),
        isUserFacing: consolidated.isUserFacing,
        candidateFeatureKey: input.candidateFeatureKey,
        keywords,
        sourceDomains,
        phase2Fingerprint: buildPhase2ConsolidationFingerprint({
          candidateFeatureKey: input.candidateFeatureKey,
          sourceBehaviorIds: consolidated.sourceBehaviorIds,
          behaviors: input.inputs.map((item) => item.behavior),
          phaseVersion: input.phase2Version,
        }),
        lastConsolidatedAt: new Date().toISOString(),
      },
    }),
    input.currentEntries,
  )
}

async function consolidateCandidateFeature(input: {
  readonly progress: Progress
  readonly consolidatedManifest: ConsolidatedManifest
  readonly phase2Version: string
  readonly candidateFeatureKey: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
}): Promise<ConsolidatedManifest> {
  const failedAttempts = getFailedBatchAttempts(input.progress, input.candidateFeatureKey)
  if (failedAttempts >= MAX_RETRIES) {
    return input.consolidatedManifest
  }

  const result = await consolidateWithRetry(input.candidateFeatureKey, input.inputs, failedAttempts)
  if (result === null) {
    markBatchFailed(input.progress, input.candidateFeatureKey, 'consolidation failed after retries', failedAttempts + 1)
    await saveProgress(input.progress)
    return input.consolidatedManifest
  }

  const consolidations = toConsolidations(result, input.inputs)
  await writeConsolidatedFile(input.candidateFeatureKey, consolidations)
  markBatchDone(input.progress, input.candidateFeatureKey, consolidations)
  await saveProgress(input.progress)

  return {
    ...input.consolidatedManifest,
    entries: updateManifestEntries({
      currentEntries: input.consolidatedManifest.entries,
      candidateFeatureKey: input.candidateFeatureKey,
      inputs: input.inputs,
      consolidations,
      phase2Version: input.phase2Version,
    }),
  }
}

export async function runPhase2b(
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
  selectedCandidateFeatureKeys: ReadonlySet<string>,
): Promise<ConsolidatedManifest> {
  const groups = [
    ...groupByCandidateFeature(progress.phase2a.classifiedBehaviors, selectedCandidateFeatureKeys).entries(),
  ]
  progress.phase2b.status = 'in-progress'
  progress.phase2b.stats.candidateFeaturesTotal = groups.length
  resetPhase3(progress)
  await saveProgress(progress)

  const limit = pLimit(1)
  let currentManifest = consolidatedManifest
  await Promise.all(
    groups.map(([candidateFeatureKey, inputs]) =>
      limit(async () => {
        currentManifest = await consolidateCandidateFeature({
          progress,
          consolidatedManifest: currentManifest,
          phase2Version,
          candidateFeatureKey,
          inputs,
        })
      }),
    ),
  )

  progress.phase2b.status = 'done'
  await saveProgress(progress)
  return currentManifest
}
