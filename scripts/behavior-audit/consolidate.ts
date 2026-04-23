import { relative } from 'node:path'

import pLimit from 'p-limit'

import { consolidatedArtifactPathForFeatureKey } from './artifact-paths.js'
import type { ClassifiedBehavior } from './classified-store.js'
import { readClassifiedFile } from './classified-store.js'
import { MAX_RETRIES, PROJECT_ROOT } from './config.js'
import type { ConsolidateBehaviorInput } from './consolidate-agent.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import { readExtractedFile } from './extracted-store.js'
import type { ConsolidatedManifest, IncrementalManifest, ManifestTestEntry } from './incremental.js'
import { buildPhase2ConsolidationFingerprint } from './incremental.js'
import type { Progress } from './progress.js'
import {
  getFailedFeatureKeyAttempts,
  markFeatureKeyDone,
  markFeatureKeyFailed,
  resetPhase3,
  saveProgress,
} from './progress.js'
import type { ConsolidatedBehavior } from './report-writer.js'
import { writeConsolidatedFile } from './report-writer.js'

type ConsolidateWithRetry = typeof import('./consolidate-agent.js').consolidateWithRetry

interface Phase2bDeps {
  readonly consolidateWithRetry: ConsolidateWithRetry
  readonly writeConsolidatedFile: typeof writeConsolidatedFile
  readonly readExtractedFile: typeof readExtractedFile
  readonly readClassifiedFile: typeof readClassifiedFile
}

interface JoinedBehaviorInput extends ConsolidateBehaviorInput {
  readonly featureKey: string
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
}

function getManifestFeatureKey(entry: ManifestTestEntry): string | null {
  return entry.featureKey ?? null
}

function getManifestBehaviorId(testKey: string, entry: ManifestTestEntry): string {
  return entry.behaviorId ?? testKey
}

function getSelectedManifestEntries(
  manifest: IncrementalManifest,
  selectedFeatureKeys: ReadonlySet<string>,
): readonly (readonly [string, ManifestTestEntry])[] {
  return Object.entries(manifest.tests).filter(([, entry]) => {
    const featureKey = getManifestFeatureKey(entry)
    if (featureKey === null || entry.classifiedArtifactPath === null || entry.extractedArtifactPath === null) {
      return false
    }
    return selectedFeatureKeys.size === 0 || selectedFeatureKeys.has(featureKey)
  })
}

async function loadJoinedInput(input: {
  readonly testKey: string
  readonly entry: ManifestTestEntry
  readonly deps: Phase2bDeps
}): Promise<JoinedBehaviorInput | null> {
  const featureKey = getManifestFeatureKey(input.entry)
  if (featureKey === null) {
    return null
  }

  const [extractedRecords, classifiedRecords] = await Promise.all([
    input.deps.readExtractedFile(input.entry.testFile),
    input.deps.readClassifiedFile(input.entry.testFile),
  ])

  if (extractedRecords === null || classifiedRecords === null) {
    return null
  }

  const behaviorId = getManifestBehaviorId(input.testKey, input.entry)
  const extractedRecord = findExtractedRecord(extractedRecords, behaviorId, input.testKey)
  const classifiedRecord = findClassifiedRecord(classifiedRecords, behaviorId, input.testKey)
  if (extractedRecord === null || classifiedRecord === null) {
    return null
  }

  return {
    behaviorId,
    testKey: input.testKey,
    domain: classifiedRecord.domain,
    visibility: classifiedRecord.visibility,
    featureKey,
    featureLabel: classifiedRecord.featureLabel,
    behavior: extractedRecord.behavior,
    context: extractedRecord.context,
    keywords: extractedRecord.keywords,
  }
}

function findExtractedRecord(
  extractedRecords: readonly ExtractedBehaviorRecord[],
  behaviorId: string,
  testKey: string,
): ExtractedBehaviorRecord | null {
  return extractedRecords.find((item) => item.behaviorId === behaviorId || item.testKey === testKey) ?? null
}

function findClassifiedRecord(
  classifiedRecords: readonly ClassifiedBehavior[],
  behaviorId: string,
  testKey: string,
): ClassifiedBehavior | null {
  return classifiedRecords.find((item) => item.behaviorId === behaviorId || item.testKey === testKey) ?? null
}

async function loadGroupedInputs(
  manifest: IncrementalManifest,
  selectedFeatureKeys: ReadonlySet<string>,
  deps: Phase2bDeps,
): Promise<ReadonlyMap<string, readonly ConsolidateBehaviorInput[]>> {
  const joinedInputs = await Promise.all(
    getSelectedManifestEntries(manifest, selectedFeatureKeys).map(([testKey, entry]) =>
      loadJoinedInput({ testKey, entry, deps }),
    ),
  )

  return joinedInputs
    .filter((item): item is JoinedBehaviorInput => item !== null)
    .reduce((grouped, item) => {
      grouped.set(item.featureKey, [...(grouped.get(item.featureKey) ?? []), item])
      return grouped
    }, new Map<string, ConsolidateBehaviorInput[]>())
}

function buildConsolidatedDomain(inputs: readonly ConsolidateBehaviorInput[]): string {
  const domains = [...new Set(inputs.map((item) => item.domain))].toSorted()
  return domains.length === 1 ? (domains[0] ?? 'unknown') : 'cross-domain'
}

function toConsolidations(
  result: NonNullable<Awaited<ReturnType<ConsolidateWithRetry>>>,
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
  readonly featureKey: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
  readonly consolidations: readonly ConsolidatedBehavior[]
  readonly phase2Version: string
}): ConsolidatedManifest['entries'] {
  const baseEntries = Object.fromEntries(
    Object.entries(input.currentEntries).filter(([, entry]) => entry.featureKey !== input.featureKey),
  )
  const keywords = [...new Set(input.inputs.flatMap((item) => item.keywords))].toSorted()
  const sourceDomains = [...new Set(input.inputs.map((item) => item.domain))].toSorted()
  const consolidatedArtifactPath = relative(PROJECT_ROOT, consolidatedArtifactPathForFeatureKey(input.featureKey))
  const lastConsolidatedAt = new Date().toISOString()

  return input.consolidations.reduce((entries, consolidated) => {
    entries[consolidated.id] = {
      consolidatedId: consolidated.id,
      domain: consolidated.domain,
      featureName: consolidated.featureName,
      consolidatedArtifactPath,
      evaluatedArtifactPath: null,
      sourceTestKeys: consolidated.sourceTestKeys,
      sourceBehaviorIds: consolidated.sourceBehaviorIds,
      supportingInternalBehaviorIds: consolidated.supportingInternalRefs.map((item) => item.behaviorId),
      isUserFacing: consolidated.isUserFacing,
      featureKey: input.featureKey,
      keywords,
      sourceDomains,
      phase2Fingerprint: buildPhase2ConsolidationFingerprint({
        featureKey: input.featureKey,
        sourceBehaviorIds: consolidated.sourceBehaviorIds,
        behaviors: input.inputs.map((item) => item.behavior),
        phaseVersion: input.phase2Version,
      }),
      phase3Fingerprint: null,
      lastConsolidatedAt,
      lastEvaluatedAt: null,
    }
    return entries
  }, baseEntries)
}

async function consolidateFeatureKey(input: {
  readonly progress: Progress
  readonly consolidatedManifest: ConsolidatedManifest
  readonly phase2Version: string
  readonly featureKey: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
  readonly deps: Phase2bDeps
}): Promise<ConsolidatedManifest> {
  const failedAttempts = getFailedFeatureKeyAttempts(input.progress, input.featureKey)
  if (failedAttempts >= MAX_RETRIES) {
    return input.consolidatedManifest
  }

  const result = await input.deps.consolidateWithRetry(input.featureKey, input.inputs, failedAttempts)
  if (result === null) {
    markFeatureKeyFailed(input.progress, input.featureKey, 'consolidation failed after retries', failedAttempts + 1)
    await saveProgress(input.progress)
    return input.consolidatedManifest
  }

  const consolidations = toConsolidations(result, input.inputs)
  await input.deps.writeConsolidatedFile(input.featureKey, consolidations)
  markFeatureKeyDone(input.progress, input.featureKey, consolidations)
  await saveProgress(input.progress)

  return {
    ...input.consolidatedManifest,
    entries: updateManifestEntries({
      currentEntries: input.consolidatedManifest.entries,
      featureKey: input.featureKey,
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
  selectedFeatureKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
  deps: Partial<Phase2bDeps> = {},
): Promise<ConsolidatedManifest> {
  const resolvedDeps: Phase2bDeps = { ...defaultPhase2bDeps, ...deps }
  const groups = [...(await loadGroupedInputs(manifest, selectedFeatureKeys, resolvedDeps)).entries()]
  progress.phase2b.status = 'in-progress'
  progress.phase2b.stats.featureKeysTotal = groups.length
  resetPhase3(progress)
  await saveProgress(progress)

  const limit = pLimit(1)
  let currentManifest = consolidatedManifest
  await Promise.all(
    groups.map(([featureKey, inputs]) =>
      limit(async () => {
        currentManifest = await consolidateFeatureKey({
          progress,
          consolidatedManifest: currentManifest,
          phase2Version,
          featureKey,
          inputs,
          deps: resolvedDeps,
        })
      }),
    ),
  )

  progress.phase2b.status = 'done'
  await saveProgress(progress)
  return currentManifest
}
