import { relative } from 'node:path'

import pLimit from 'p-limit'

import { classifiedArtifactPathForTestFile } from './artifact-paths.js'
import type { ClassifiedBehavior } from './classified-store.js'
import { readClassifiedFile, writeClassifiedFile } from './classified-store.js'
import { classifyBehaviorWithRetry } from './classify-agent.js'
import {
  addDirtyFeatureKey,
  buildBehaviorId,
  buildPrompt,
  loadSelectedBehaviors,
  shouldReuseCompletedClassification,
  toClassifiedBehavior,
  type SelectedBehaviorEntry,
} from './classify-phase2a-helpers.js'
import { MAX_RETRIES, PROJECT_ROOT, formatElapsedMs } from './config.js'
import { readExtractedFile } from './extracted-store.js'
import type { IncrementalManifest } from './incremental.js'
import { buildPhase2Fingerprint, saveManifest } from './incremental.js'
import {
  type AgentUsage,
  type PhaseStats,
  createPhaseStats,
  formatPerItemSuffix,
  formatPhaseSummary,
  recordItemDone,
  recordItemFailed,
  recordItemSkipped,
} from './phase-stats.js'
import type { Progress } from './progress.js'
import {
  getFailedClassificationAttempts,
  markClassificationDone,
  saveProgress,
  setClassificationFailedAttempts,
} from './progress.js'

type ClassificationProcessResult =
  | { readonly kind: 'reused'; readonly manifest: IncrementalManifest }
  | { readonly kind: 'classified'; readonly manifest: IncrementalManifest }
  | { readonly kind: 'failed'; readonly manifest: IncrementalManifest }

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
  readonly log: Pick<typeof console, 'log'>
  readonly writeStdout: (text: string) => void
  readonly stats?: PhaseStats
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
    log: console,
    writeStdout: (text) => {
      process.stdout.write(text)
    },
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
): Promise<{ classified: ClassifiedBehavior; usage: AgentUsage } | null> {
  const behaviorId = buildBehaviorId(entry.testKey)
  const failedAttempts = deps.getFailedClassificationAttempts(progress, behaviorId)
  if (failedAttempts >= deps.maxRetries) {
    return null
  }

  const agentResult = await deps.classifyBehaviorWithRetry(buildPrompt(entry.testKey, entry.behavior), failedAttempts)
  if (agentResult === null) {
    deps.setClassificationFailedAttempts(progress, behaviorId, 'classification failed after retries', deps.maxRetries)
    return null
  }

  const classified = toClassifiedBehavior(entry.testKey, agentResult.result)
  deps.markClassificationDone(progress, behaviorId)
  return { classified, usage: agentResult.usage }
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
    phase2aFingerprint: buildPhase2Fingerprint({
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
  readonly dirtyFeatureKeys: Set<string>
  readonly deps: Phase2aDeps
}): Promise<ClassificationProcessResult & { readonly usage: AgentUsage | null }> {
  if (shouldReuseCompletedClassification(input.progress, input.manifest, input.entry)) {
    addDirtyFeatureKey(input.dirtyFeatureKeys, input.manifest.tests[input.entry.testKey]?.featureKey ?? null)
    return { kind: 'reused', manifest: input.manifest, usage: null }
  }

  const classifyResult = await classifySelectedBehavior(input.progress, input.entry, input.deps)
  if (classifyResult === null) {
    await input.deps.saveProgress(input.progress)
    return { kind: 'failed', manifest: input.manifest, usage: null }
  }

  addDirtyFeatureKey(input.dirtyFeatureKeys, classifyResult.classified.featureKey)
  const updatedManifest = await persistSuccessfulClassification({
    progress: input.progress,
    manifest: input.manifest,
    entry: input.entry,
    classified: classifyResult.classified,
    deps: input.deps,
  })
  return { kind: 'classified', manifest: updatedManifest, usage: classifyResult.usage }
}

function logClassificationResult(
  deps: Phase2aDeps,
  result: ClassificationProcessResult & { readonly usage: AgentUsage | null },
  elapsedMs: number,
): void {
  switch (result.kind) {
    case 'reused':
      deps.log.log('(reused)')
      break
    case 'classified':
      if (result.usage !== null) {
        deps.log.log(formatPerItemSuffix(result.usage, elapsedMs))
      } else {
        deps.log.log(`(${formatElapsedMs(elapsedMs)}) ✓`)
      }
      break
    case 'failed':
      deps.log.log(`(${formatElapsedMs(elapsedMs)}) ✗`)
      break
  }
}

async function processSelectedEntry(
  entry: SelectedBehaviorEntry,
  displayIndex: number,
  displayTotal: number,
  progress: Progress,
  manifest: IncrementalManifest,
  dirtyFeatureKeys: Set<string>,
  deps: Phase2aDeps,
): Promise<ClassificationProcessResult> {
  deps.writeStdout(`  [${displayIndex}/${displayTotal}] "${entry.behavior.fullPath}" `)
  const startMs = performance.now()
  const result = await processSelectedClassification({
    progress,
    entry,
    manifest,
    dirtyFeatureKeys,
    deps,
  })
  const elapsedMs = performance.now() - startMs
  logClassificationResult(deps, result, elapsedMs)
  if (deps.stats !== undefined) {
    if (result.kind === 'classified' && result.usage !== null) {
      recordItemDone(deps.stats, result.usage)
    } else if (result.kind === 'failed') {
      recordItemFailed(deps.stats, result.usage ?? undefined)
    } else if (result.kind === 'reused') {
      recordItemSkipped(deps.stats)
    }
  }
  return result
}

export async function runPhase2a(input: Phase2aRunInput): Promise<ReadonlySet<string>>
export async function runPhase2a(input: Phase2aRunInput, deps: Partial<Phase2aDeps>): Promise<ReadonlySet<string>>
export async function runPhase2a(
  input: Phase2aRunInput,
  ...args: readonly [] | readonly [Partial<Phase2aDeps>]
): Promise<ReadonlySet<string>> {
  const { progress, selectedTestKeys, manifest } = input
  const defaultPhase2aDeps = createDefaultPhase2aDeps()
  const stats = createPhaseStats()
  const resolvedDeps: Phase2aDeps =
    args.length === 0 ? { ...defaultPhase2aDeps, stats } : { ...defaultPhase2aDeps, ...args[0], stats }
  progress.phase2a.status = 'in-progress'
  const dirtyFeatureKeys = new Set<string>()
  const limit = pLimit(1)
  let currentManifest = manifest

  const selectedEntries = await loadSelectedBehaviors(manifest, selectedTestKeys, resolvedDeps.readExtractedFile)
  progress.phase2a.stats.behaviorsTotal = selectedEntries.length
  await resolvedDeps.saveProgress(progress)

  await Promise.all(
    selectedEntries.map((entry, index) =>
      limit(async () => {
        const result = await processSelectedEntry(
          entry,
          index + 1,
          selectedEntries.length,
          progress,
          currentManifest,
          dirtyFeatureKeys,
          resolvedDeps,
        )
        currentManifest = result.manifest
      }),
    ),
  )

  progress.phase2a.status = 'done'
  await resolvedDeps.saveProgress(progress)
  const wallMs = performance.now() - stats.wallStartMs
  const label = `[Phase 2a complete] ${progress.phase2a.stats.behaviorsDone} classified, ${progress.phase2a.stats.behaviorsFailed} failed`
  resolvedDeps.log.log(`\n${formatPhaseSummary(stats, wallMs, label)}`)
  return dirtyFeatureKeys
}
