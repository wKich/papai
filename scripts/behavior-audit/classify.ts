import pLimit from 'p-limit'

import type { ClassifiedBehavior } from './classified-store.js'
import { readClassifiedFile, writeClassifiedFile } from './classified-store.js'
import { classifyBehaviorWithRetry } from './classify-agent.js'
import {
  addDirtyCandidateFeatureKey,
  buildBehaviorId,
  buildPrompt,
  selectBehaviors,
  shouldReuseCompletedClassification,
  toClassifiedBehavior,
  type SelectedBehaviorEntry,
} from './classify-phase2a-helpers.js'
import { MAX_RETRIES } from './config.js'
import type { IncrementalManifest } from './incremental.js'
import { buildPhase2aFingerprint, saveManifest } from './incremental.js'
import type { Progress } from './progress.js'
import {
  getFailedClassificationAttempts,
  markClassificationDone,
  saveProgress,
  setClassificationFailedAttempts,
} from './progress.js'
import type { ExtractedBehavior } from './report-writer.js'

export interface Phase2aDeps {
  readonly classifyBehaviorWithRetry: typeof classifyBehaviorWithRetry
  readonly readClassifiedFile: typeof readClassifiedFile
  readonly writeClassifiedFile: typeof writeClassifiedFile
  readonly saveManifest: typeof saveManifest
  readonly saveProgress: typeof saveProgress
  readonly getFailedClassificationAttempts: typeof getFailedClassificationAttempts
  readonly markClassificationDone: typeof markClassificationDone
  readonly setClassificationFailedAttempts: typeof setClassificationFailedAttempts
  readonly maxRetries: number
}

function createDefaultPhase2aDeps(): Phase2aDeps {
  return {
    classifyBehaviorWithRetry,
    readClassifiedFile,
    writeClassifiedFile,
    saveManifest,
    saveProgress,
    getFailedClassificationAttempts,
    markClassificationDone,
    setClassificationFailedAttempts,
    maxRetries: MAX_RETRIES,
  }
}

interface Phase2aRunInput {
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
}

async function classifySelectedBehavior(
  progress: Progress,
  entry: SelectedBehaviorEntry,
  deps: Phase2aDeps,
): Promise<ClassifiedBehavior | null> {
  const behaviorId = buildBehaviorId(entry.testKey)
  const failedAttempts = deps.getFailedClassificationAttempts(progress, behaviorId)
  if (failedAttempts >= deps.maxRetries) {
    return null
  }

  const result = await deps.classifyBehaviorWithRetry(buildPrompt(entry.testKey, entry.behavior), failedAttempts)
  if (result === null) {
    deps.setClassificationFailedAttempts(progress, behaviorId, 'classification failed after retries', deps.maxRetries)
    return null
  }

  const classified = toClassifiedBehavior(entry.testKey, entry.behavior, result)
  deps.markClassificationDone(progress, behaviorId, classified)
  return classified
}

async function writeSingleClassification(classified: ClassifiedBehavior, deps: Phase2aDeps): Promise<void> {
  const existing = await deps.readClassifiedFile(classified.domain)
  let existingItems: readonly ClassifiedBehavior[] = []
  if (existing !== null) {
    existingItems = existing
  }
  const untouched = existingItems.filter((item) => item.behaviorId !== classified.behaviorId)
  await deps.writeClassifiedFile(classified.domain, [...untouched, classified])
}

function toManifestEntry(input: {
  readonly previousEntry: IncrementalManifest['tests'][string] | undefined
  readonly classified: ClassifiedBehavior
  readonly behavior: ExtractedBehavior
  readonly phase2Version: string
}): IncrementalManifest['tests'][string] {
  const [firstSegment] = input.classified.testKey.split('::')
  let testFile = ''
  if (firstSegment !== undefined) {
    testFile = firstSegment
  }
  const completedAt = new Date().toISOString()
  const previousEntry = input.previousEntry
  return {
    testFile: previousEntry === undefined ? testFile : previousEntry.testFile,
    testName: previousEntry === undefined ? input.behavior.fullPath : previousEntry.testName,
    dependencyPaths: previousEntry === undefined ? [testFile] : previousEntry.dependencyPaths,
    phase1Fingerprint: previousEntry === undefined ? null : previousEntry.phase1Fingerprint,
    phase2aFingerprint: buildPhase2aFingerprint({
      testKey: input.classified.testKey,
      behavior: input.behavior.behavior,
      context: input.behavior.context,
      keywords: input.behavior.keywords,
      phaseVersion: input.phase2Version,
    }),
    phase2Fingerprint: previousEntry === undefined ? null : previousEntry.phase2Fingerprint,
    behaviorId: input.classified.behaviorId,
    featureKey: input.classified.candidateFeatureKey,
    extractedArtifactPath: previousEntry === undefined ? null : previousEntry.extractedArtifactPath,
    classifiedArtifactPath: previousEntry === undefined ? null : previousEntry.classifiedArtifactPath,
    domain: previousEntry === undefined ? input.classified.domain : previousEntry.domain,
    lastPhase1CompletedAt: previousEntry === undefined ? null : previousEntry.lastPhase1CompletedAt,
    lastPhase2aCompletedAt: completedAt,
    lastPhase2CompletedAt: previousEntry === undefined ? null : previousEntry.lastPhase2CompletedAt,
  }
}

function updateManifestForClassification(
  manifest: IncrementalManifest,
  classified: ClassifiedBehavior,
  behavior: ExtractedBehavior,
): IncrementalManifest {
  const previousEntry = manifest.tests[classified.testKey]
  const nextEntry = toManifestEntry({
    previousEntry,
    classified,
    behavior,
    phase2Version: manifest.phaseVersions.phase2,
  })
  return {
    ...manifest,
    tests: {
      ...manifest.tests,
      [classified.testKey]: nextEntry,
    },
  }
}

async function persistSuccessfulClassification(input: {
  readonly progress: Progress
  readonly manifest: IncrementalManifest
  readonly entry: SelectedBehaviorEntry
  readonly classified: ClassifiedBehavior
  readonly deps: Phase2aDeps
}): Promise<IncrementalManifest> {
  await writeSingleClassification(input.classified, input.deps)
  const updatedManifest = updateManifestForClassification(input.manifest, input.classified, input.entry.behavior)
  await input.deps.saveManifest(updatedManifest)
  await input.deps.saveProgress(input.progress)
  return updatedManifest
}

export async function runPhase2a(input: Phase2aRunInput): Promise<ReadonlySet<string>>
export async function runPhase2a(input: Phase2aRunInput, deps: Partial<Phase2aDeps>): Promise<ReadonlySet<string>>
export async function runPhase2a(
  input: Phase2aRunInput,
  ...args: readonly [] | readonly [Partial<Phase2aDeps>]
): Promise<ReadonlySet<string>> {
  const { progress, selectedTestKeys, manifest } = input
  const defaultPhase2aDeps = createDefaultPhase2aDeps()
  const resolvedDeps: Phase2aDeps = args.length === 0 ? defaultPhase2aDeps : { ...defaultPhase2aDeps, ...args[0] }
  progress.phase2a.status = 'in-progress'
  const dirtyCandidateFeatureKeys = new Set<string>()
  const limit = pLimit(1)
  let currentManifest = manifest

  const selectedEntries = selectBehaviors(progress, selectedTestKeys)
  progress.phase2a.stats.behaviorsTotal = selectedEntries.length
  await resolvedDeps.saveProgress(progress)

  await Promise.all(
    selectedEntries.map((entry) =>
      limit(async () => {
        if (shouldReuseCompletedClassification(progress, currentManifest, entry)) {
          addDirtyCandidateFeatureKey(
            dirtyCandidateFeatureKeys,
            currentManifest.tests[entry.testKey]?.featureKey ?? null,
          )
          return
        }

        const classified = await classifySelectedBehavior(progress, entry, resolvedDeps)
        if (classified === null) {
          await resolvedDeps.saveProgress(progress)
          return
        }

        addDirtyCandidateFeatureKey(dirtyCandidateFeatureKeys, classified.candidateFeatureKey)
        currentManifest = await persistSuccessfulClassification({
          progress,
          manifest: currentManifest,
          entry,
          classified,
          deps: resolvedDeps,
        })
      }),
    ),
  )

  progress.phase2a.status = 'done'
  await resolvedDeps.saveProgress(progress)
  return dirtyCandidateFeatureKeys
}
