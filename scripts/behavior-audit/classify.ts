import { relative } from 'node:path'

import pLimit from 'p-limit'

import { classifiedArtifactPathForTestFile } from './artifact-paths.js'
import type { ClassifiedBehavior } from './classified-store.js'
import { readClassifiedFile, writeClassifiedFile } from './classified-store.js'
import { classifyBehaviorWithRetry } from './classify-agent.js'
import {
  addDirtyCandidateFeatureKey,
  buildBehaviorId,
  buildPrompt,
  loadSelectedBehaviors,
  shouldReuseCompletedClassification,
  toClassifiedBehavior,
  type SelectedBehaviorEntry,
} from './classify-phase2a-helpers.js'
import { MAX_RETRIES, PROJECT_ROOT } from './config.js'
import { readExtractedFile } from './extracted-store.js'
import type { IncrementalManifest } from './incremental.js'
import { buildPhase2aFingerprint, saveManifest } from './incremental.js'
import type { Progress } from './progress.js'
import {
  getFailedClassificationAttempts,
  markClassificationDone,
  saveProgress,
  setClassificationFailedAttempts,
} from './progress.js'

export interface Phase2aDeps {
  readonly classifyBehaviorWithRetry: typeof classifyBehaviorWithRetry
  readonly readClassifiedFile: typeof readClassifiedFile
  readonly writeClassifiedFile: typeof writeClassifiedFile
  readonly readExtractedFile: typeof readExtractedFile
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
    readExtractedFile,
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

  const classified = toClassifiedBehavior(entry.testKey, result)
  deps.markClassificationDone(progress, behaviorId, classified)
  return classified
}

async function writeSingleClassification(classified: ClassifiedBehavior, deps: Phase2aDeps): Promise<void> {
  const testFilePath = classified.testKey.split('::')[0] ?? ''
  const existing = await deps.readClassifiedFile(testFilePath)
  let existingItems: readonly ClassifiedBehavior[] = []
  if (existing !== null) {
    existingItems = existing
  }
  const untouched = existingItems.filter((item) => item.behaviorId !== classified.behaviorId)
  await deps.writeClassifiedFile(testFilePath, [...untouched, classified])
}

function toManifestEntry(input: {
  readonly previousEntry: IncrementalManifest['tests'][string] | undefined
  readonly classified: ClassifiedBehavior
  readonly behavior: SelectedBehaviorEntry['behavior']
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
    featureKey: input.classified.featureKey,
    extractedArtifactPath: previousEntry === undefined ? null : previousEntry.extractedArtifactPath,
    classifiedArtifactPath: relative(PROJECT_ROOT, classifiedArtifactPathForTestFile(testFile)),
    domain: previousEntry === undefined ? input.classified.domain : previousEntry.domain,
    lastPhase1CompletedAt: previousEntry === undefined ? null : previousEntry.lastPhase1CompletedAt,
    lastPhase2aCompletedAt: completedAt,
    lastPhase2CompletedAt: previousEntry === undefined ? null : previousEntry.lastPhase2CompletedAt,
  }
}

function updateManifestForClassification(
  manifest: IncrementalManifest,
  classified: ClassifiedBehavior,
  behavior: SelectedBehaviorEntry['behavior'],
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

async function processSelectedClassification(input: {
  readonly progress: Progress
  readonly entry: SelectedBehaviorEntry
  readonly manifest: IncrementalManifest
  readonly dirtyCandidateFeatureKeys: Set<string>
  readonly deps: Phase2aDeps
}): Promise<IncrementalManifest> {
  if (shouldReuseCompletedClassification(input.progress, input.manifest, input.entry)) {
    addDirtyCandidateFeatureKey(
      input.dirtyCandidateFeatureKeys,
      input.manifest.tests[input.entry.testKey]?.featureKey ?? null,
    )
    return input.manifest
  }

  const classified = await classifySelectedBehavior(input.progress, input.entry, input.deps)
  if (classified === null) {
    await input.deps.saveProgress(input.progress)
    return input.manifest
  }

  addDirtyCandidateFeatureKey(input.dirtyCandidateFeatureKeys, classified.featureKey)
  return persistSuccessfulClassification({
    progress: input.progress,
    manifest: input.manifest,
    entry: input.entry,
    classified,
    deps: input.deps,
  })
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

  const selectedEntries = await loadSelectedBehaviors(manifest, selectedTestKeys, resolvedDeps.readExtractedFile)
  progress.phase2a.stats.behaviorsTotal = selectedEntries.length
  await resolvedDeps.saveProgress(progress)

  await Promise.all(
    selectedEntries.map((entry) =>
      limit(async () => {
        currentManifest = await processSelectedClassification({
          progress,
          entry,
          manifest: currentManifest,
          dirtyCandidateFeatureKeys,
          deps: resolvedDeps,
        })
      }),
    ),
  )

  progress.phase2a.status = 'done'
  await resolvedDeps.saveProgress(progress)
  return dirtyCandidateFeatureKeys
}
