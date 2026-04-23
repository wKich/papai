import type { ClassifiedBehavior } from './classified-store.js'
import { getDomain } from './domain-map.js'
import { readExtractedFile, type ExtractedBehaviorRecord } from './extracted-store.js'
import { buildPhase2aFingerprint, type IncrementalManifest } from './incremental.js'
import type { Progress } from './progress.js'

export interface SelectedBehaviorEntry {
  readonly testKey: string
  readonly behavior: ExtractedBehaviorRecord
}

function isExtractedBehaviorMap(value: unknown): value is Readonly<Record<string, ExtractedBehaviorRecord>> {
  return typeof value === 'object' && value !== null
}

export function buildBehaviorId(testKey: string): string {
  return testKey
}

export function buildPrompt(testKey: string, behavior: ExtractedBehaviorRecord): string {
  const testFile = testKey.split('::')[0] ?? ''
  return [
    `Test key: ${testKey}`,
    `Domain: ${getDomain(testFile)}`,
    `Behavior: ${behavior.behavior}`,
    `Context: ${behavior.context}`,
    `Keywords: ${behavior.keywords.join(', ')}`,
  ].join('\n')
}

function getBehaviorIdForManifestEntry(manifestEntry: IncrementalManifest['tests'][string], testKey: string): string {
  return manifestEntry.behaviorId ?? testKey
}

function getLegacySelectedBehaviors(
  progress: Progress,
  selectedTestKeys: ReadonlySet<string>,
): readonly SelectedBehaviorEntry[] {
  const extractedBehaviors =
    'extractedBehaviors' in progress.phase1 && isExtractedBehaviorMap(progress.phase1['extractedBehaviors'])
      ? progress.phase1['extractedBehaviors']
      : {}

  return Object.entries(extractedBehaviors)
    .filter(([testKey]) => selectedTestKeys.size === 0 || selectedTestKeys.has(testKey))
    .map(([testKey, behavior]) => ({ testKey, behavior }))
}

async function loadSelectedBehaviorFromArtifact(input: {
  readonly manifestEntry: IncrementalManifest['tests'][string]
  readonly testKey: string
  readonly readExtractedFile: typeof readExtractedFile
}): Promise<SelectedBehaviorEntry | null> {
  if (input.manifestEntry.extractedArtifactPath === null) {
    return null
  }

  const extractedRecords = await input.readExtractedFile(input.manifestEntry.testFile)
  if (extractedRecords === null) {
    return null
  }

  const behaviorId = getBehaviorIdForManifestEntry(input.manifestEntry, input.testKey)
  const record = extractedRecords.find((item) => item.behaviorId === behaviorId || item.testKey === input.testKey)
  if (record === undefined) {
    return null
  }

  return { testKey: input.testKey, behavior: record }
}

export async function loadSelectedBehaviors(
  progress: Progress,
  manifest: IncrementalManifest,
  selectedTestKeys: ReadonlySet<string>,
  readExtractedFileImpl: typeof readExtractedFile,
): Promise<readonly SelectedBehaviorEntry[]> {
  const manifestKeys = selectedTestKeys.size === 0 ? Object.keys(manifest.tests) : [...selectedTestKeys]
  const loadedEntries = await Promise.all(
    manifestKeys.map((testKey) => {
      const manifestEntry = manifest.tests[testKey]
      if (manifestEntry === undefined) {
        return Promise.resolve<SelectedBehaviorEntry | null>(null)
      }

      return loadSelectedBehaviorFromArtifact({
        manifestEntry,
        testKey,
        readExtractedFile: readExtractedFileImpl,
      })
    }),
  )

  const artifactEntries = loadedEntries.filter((entry): entry is SelectedBehaviorEntry => entry !== null)
  if (artifactEntries.length > 0) {
    return artifactEntries
  }

  return getLegacySelectedBehaviors(progress, selectedTestKeys)
}

export function shouldReuseCompletedClassification(
  progress: Progress,
  manifest: IncrementalManifest,
  entry: SelectedBehaviorEntry,
): boolean {
  if (progress.phase2a.completedBehaviors[entry.testKey] !== 'done') {
    return false
  }

  if (!entry.testKey.startsWith('tests/')) {
    return true
  }

  const manifestEntry = manifest.tests[entry.testKey]
  if (manifestEntry === undefined) {
    return true
  }

  const nextFingerprint = buildPhase2aFingerprint({
    testKey: entry.testKey,
    behavior: entry.behavior.behavior,
    context: entry.behavior.context,
    keywords: entry.behavior.keywords,
    phaseVersion: manifest.phaseVersions.phase2,
  })
  return manifestEntry.phase2aFingerprint === nextFingerprint
}

export function addDirtyCandidateFeatureKey(
  dirtyCandidateFeatureKeys: Set<string>,
  candidateFeatureKey: string | null,
): void {
  if (candidateFeatureKey !== null) {
    dirtyCandidateFeatureKeys.add(candidateFeatureKey)
  }
}

export function toClassifiedBehavior(
  testKey: string,
  result: NonNullable<Awaited<ReturnType<typeof import('./classify-agent.js').classifyBehaviorWithRetry>>>,
): ClassifiedBehavior {
  const domain = getDomain(testKey.split('::')[0] ?? '')

  return {
    behaviorId: buildBehaviorId(testKey),
    testKey,
    domain,
    visibility: result.visibility,
    featureKey: result.candidateFeatureKey,
    featureLabel: result.candidateFeatureLabel,
    supportingBehaviorRefs: result.supportingBehaviorRefs,
    relatedBehaviorHints: result.relatedBehaviorHints,
    classificationNotes: result.classificationNotes,
    classifiedAt: new Date().toISOString(),
  }
}
