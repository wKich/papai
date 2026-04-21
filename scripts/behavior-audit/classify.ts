import pLimit from 'p-limit'

import type { ClassifiedBehavior } from './classified-store.js'
import { readClassifiedFile, writeClassifiedFile } from './classified-store.js'
import { classifyBehaviorWithRetry } from './classify-agent.js'
import { MAX_RETRIES } from './config.js'
import { getDomain } from './domain-map.js'
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

interface Phase2aRunInput {
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
}

interface SelectedBehaviorEntry {
  readonly testKey: string
  readonly behavior: ExtractedBehavior
}

function buildBehaviorId(testKey: string): string {
  return testKey
}

function buildPrompt(testKey: string, behavior: ExtractedBehavior): string {
  const testFile = testKey.split('::')[0] ?? ''
  return [
    `Test key: ${testKey}`,
    `Domain: ${getDomain(testFile)}`,
    `Behavior: ${behavior.behavior}`,
    `Context: ${behavior.context}`,
    `Keywords: ${behavior.keywords.join(', ')}`,
  ].join('\n')
}

function selectBehaviors(progress: Progress, selectedTestKeys: ReadonlySet<string>): readonly SelectedBehaviorEntry[] {
  return Object.entries(progress.phase1.extractedBehaviors)
    .filter(([testKey]) => selectedTestKeys.size === 0 || selectedTestKeys.has(testKey))
    .map(([testKey, behavior]) => ({ testKey, behavior }))
}

function isClassificationCompleted(progress: Progress, testKey: string): boolean {
  return progress.phase2a.completedBehaviors[testKey] === 'done'
}

function addDirtyCandidateFeatureKey(dirtyCandidateFeatureKeys: Set<string>, candidateFeatureKey: string | null): void {
  if (candidateFeatureKey !== null) {
    dirtyCandidateFeatureKeys.add(candidateFeatureKey)
  }
}

function toClassifiedBehavior(
  testKey: string,
  behavior: ExtractedBehavior,
  result: NonNullable<Awaited<ReturnType<typeof classifyBehaviorWithRetry>>>,
): ClassifiedBehavior {
  const domain = getDomain(testKey.split('::')[0] ?? '')

  return {
    behaviorId: buildBehaviorId(testKey),
    testKey,
    domain,
    behavior: behavior.behavior,
    context: behavior.context,
    keywords: behavior.keywords,
    visibility: result.visibility,
    candidateFeatureKey: result.candidateFeatureKey,
    candidateFeatureLabel: result.candidateFeatureLabel,
    supportingBehaviorRefs: result.supportingBehaviorRefs,
    relatedBehaviorHints: result.relatedBehaviorHints,
    classificationNotes: result.classificationNotes,
  }
}

async function classifySelectedBehavior(
  progress: Progress,
  entry: SelectedBehaviorEntry,
): Promise<ClassifiedBehavior | null> {
  const behaviorId = buildBehaviorId(entry.testKey)
  const failedAttempts = getFailedClassificationAttempts(progress, behaviorId)
  if (failedAttempts >= MAX_RETRIES) {
    return null
  }

  const result = await classifyBehaviorWithRetry(buildPrompt(entry.testKey, entry.behavior), failedAttempts)
  if (result === null) {
    setClassificationFailedAttempts(progress, behaviorId, 'classification failed after retries', MAX_RETRIES)
    return null
  }

  const classified = toClassifiedBehavior(entry.testKey, entry.behavior, result)
  markClassificationDone(progress, behaviorId, classified)
  return classified
}

function addToDomainMap(byDomain: Map<string, ClassifiedBehavior[]>, classified: ClassifiedBehavior): void {
  byDomain.set(classified.domain, [...(byDomain.get(classified.domain) ?? []), classified])
}

async function writeSingleClassification(classified: ClassifiedBehavior): Promise<void> {
  const existing = (await readClassifiedFile(classified.domain)) ?? []
  const untouched = existing.filter((item) => item.behaviorId !== classified.behaviorId)
  await writeClassifiedFile(classified.domain, [...untouched, classified])
}

function toManifestEntry(input: {
  readonly previousEntry: IncrementalManifest['tests'][string] | undefined
  readonly classified: ClassifiedBehavior
  readonly behavior: ExtractedBehavior
  readonly phase2Version: string
}): IncrementalManifest['tests'][string] {
  const testFile = input.classified.testKey.split('::')[0] ?? ''
  const completedAt = new Date().toISOString()
  return {
    testFile: input.previousEntry?.testFile ?? testFile,
    testName: input.previousEntry?.testName ?? input.behavior.fullPath,
    dependencyPaths: input.previousEntry?.dependencyPaths ?? [testFile],
    phase1Fingerprint: input.previousEntry?.phase1Fingerprint ?? null,
    phase2aFingerprint: buildPhase2aFingerprint({
      testKey: input.classified.testKey,
      behavior: input.behavior.behavior,
      context: input.behavior.context,
      keywords: input.behavior.keywords,
      phaseVersion: input.phase2Version,
    }),
    phase2Fingerprint: input.previousEntry?.phase2Fingerprint ?? null,
    behaviorId: input.classified.behaviorId,
    candidateFeatureKey: input.classified.candidateFeatureKey,
    extractedBehaviorPath: input.previousEntry?.extractedBehaviorPath ?? null,
    domain: input.previousEntry?.domain ?? input.classified.domain,
    lastPhase1CompletedAt: input.previousEntry?.lastPhase1CompletedAt ?? null,
    lastPhase2aCompletedAt: completedAt,
    lastPhase2CompletedAt: completedAt,
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
}): Promise<IncrementalManifest> {
  await writeSingleClassification(input.classified)
  const updatedManifest = updateManifestForClassification(input.manifest, input.classified, input.entry.behavior)
  await saveManifest(updatedManifest)
  await saveProgress(input.progress)
  return updatedManifest
}

export async function runPhase2a({
  progress,
  selectedTestKeys,
  manifest,
}: Phase2aRunInput): Promise<ReadonlySet<string>> {
  progress.phase2a.status = 'in-progress'
  const dirtyCandidateFeatureKeys = new Set<string>()
  const byDomain = new Map<string, ClassifiedBehavior[]>()
  const limit = pLimit(1)
  let currentManifest = manifest

  const selectedEntries = selectBehaviors(progress, selectedTestKeys)
  progress.phase2a.stats.behaviorsTotal = selectedEntries.length
  await saveProgress(progress)

  await Promise.all(
    selectedEntries.map((entry) =>
      limit(async () => {
        if (isClassificationCompleted(progress, entry.testKey)) {
          addDirtyCandidateFeatureKey(
            dirtyCandidateFeatureKeys,
            progress.phase2a.classifiedBehaviors[entry.testKey]?.candidateFeatureKey ?? null,
          )
          return
        }

        const classified = await classifySelectedBehavior(progress, entry)
        if (classified === null) {
          await saveProgress(progress)
          return
        }

        addDirtyCandidateFeatureKey(dirtyCandidateFeatureKeys, classified.candidateFeatureKey)

        addToDomainMap(byDomain, classified)
        currentManifest = await persistSuccessfulClassification({
          progress,
          manifest: currentManifest,
          entry,
          classified,
        })
      }),
    ),
  )

  progress.phase2a.status = 'done'
  await saveProgress(progress)
  return dirtyCandidateFeatureKeys
}
