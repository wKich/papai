import type { ClassifiedBehavior } from './classified-store.js'
import { getDomain } from './domain-map.js'
import { buildPhase2aFingerprint, type IncrementalManifest } from './incremental.js'
import type { Progress } from './progress.js'
import type { ExtractedBehavior } from './report-writer.js'

export interface SelectedBehaviorEntry {
  readonly testKey: string
  readonly behavior: ExtractedBehavior
}

function isExtractedBehaviorMap(value: unknown): value is Readonly<Record<string, ExtractedBehavior>> {
  return typeof value === 'object' && value !== null
}

export function buildBehaviorId(testKey: string): string {
  return testKey
}

export function buildPrompt(testKey: string, behavior: ExtractedBehavior): string {
  const testFile = testKey.split('::')[0] ?? ''
  return [
    `Test key: ${testKey}`,
    `Domain: ${getDomain(testFile)}`,
    `Behavior: ${behavior.behavior}`,
    `Context: ${behavior.context}`,
    `Keywords: ${behavior.keywords.join(', ')}`,
  ].join('\n')
}

export function selectBehaviors(
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
  behavior: ExtractedBehavior,
  result: NonNullable<Awaited<ReturnType<typeof import('./classify-agent.js').classifyBehaviorWithRetry>>>,
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
