import pLimit from 'p-limit'

import { classifyBehaviorWithRetry } from './classify-agent.js'
import type { ClassifiedBehavior } from './classified-store.js'
import { readClassifiedFile, writeClassifiedFile } from './classified-store.js'
import { MAX_RETRIES } from './config.js'
import type { IncrementalManifest } from './incremental.js'
import { getDomain } from './domain-map.js'
import type { Progress } from './progress.js'
import {
  getFailedClassificationAttempts,
  markClassificationDone,
  markClassificationFailed,
  saveProgress,
} from './progress.js'
import type { ExtractedBehavior } from './report-writer.js'

interface Phase2aRunInput {
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
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

export async function runPhase2a({ progress, selectedTestKeys }: Phase2aRunInput): Promise<ReadonlySet<string>> {
  progress.phase2a.status = 'in-progress'
  const dirtyCandidateFeatureKeys = new Set<string>()
  const byDomain = new Map<string, ClassifiedBehavior[]>()
  const limit = pLimit(1)

  const selectedEntries = Object.entries(progress.phase1.extractedBehaviors).filter(([testKey]) => {
    if (selectedTestKeys.size === 0) {
      return true
    }
    return selectedTestKeys.has(testKey)
  })
  progress.phase2a.stats.behaviorsTotal = selectedEntries.length

  await Promise.all(
    selectedEntries.map(([testKey, behavior]) =>
      limit(async () => {
        const behaviorId = buildBehaviorId(testKey)
        if (getFailedClassificationAttempts(progress, behaviorId) >= MAX_RETRIES) {
          return
        }

        const result = await classifyBehaviorWithRetry(buildPrompt(testKey, behavior), 0)
        if (result === null) {
          markClassificationFailed(progress, behaviorId, 'classification failed after retries')
          return
        }

        if (result.candidateFeatureKey !== null) {
          dirtyCandidateFeatureKeys.add(result.candidateFeatureKey)
        }

        const domain = getDomain(testKey.split('::')[0] ?? '')
        const classified: ClassifiedBehavior = {
          behaviorId,
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

        markClassificationDone(progress, behaviorId, classified)
        byDomain.set(domain, [...(byDomain.get(domain) ?? []), classified])
      }),
    ),
  )

  await Promise.all(
    [...byDomain.entries()].map(async ([domain, fresh]) => {
      const existing = (await readClassifiedFile(domain)) ?? []
      const untouched = existing.filter((item) => !fresh.some((next) => next.behaviorId === item.behaviorId))
      await writeClassifiedFile(domain, [...untouched, ...fresh])
    }),
  )

  progress.phase2a.status = 'done'
  await saveProgress(progress)
  return dirtyCandidateFeatureKeys
}
