import pLimit from 'p-limit'

import { MAX_RETRIES } from './config.js'
import type { ConsolidateBehaviorInput } from './consolidate-agent.js'
import { consolidateWithRetry } from './consolidate-agent.js'
import { getDomain } from './domain-map.js'
import type { ConsolidatedManifest } from './incremental.js'
import { buildPhase2ConsolidationFingerprint } from './incremental.js'
import type { Progress } from './progress.js'
import {
  getFailedBatchAttempts,
  isBatchCompleted,
  markBatchDone,
  markBatchFailed,
  resetPhase3,
  saveProgress,
} from './progress.js'
import type { ConsolidatedBehavior, ExtractedBehavior } from './report-writer.js'
import { writeConsolidatedFile } from './report-writer.js'

interface KeywordBatch {
  readonly batchKey: string
  readonly primaryKeyword: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
}

const MAX_BATCH_SIZE = 5

function getPrimaryKeyword(keywords: readonly string[], cardinality: ReadonlyMap<string, number>): string {
  return [...keywords].toSorted((a, b) => {
    const countA = cardinality.get(a)
    if (countA === undefined) {
      const countB = cardinality.get(b)
      if (countB === undefined) {
        return a.localeCompare(b)
      }
      return Number.MAX_SAFE_INTEGER - countB
    }
    const countB = cardinality.get(b)
    if (countB === undefined) {
      return countA - Number.MAX_SAFE_INTEGER
    }
    return countA === countB ? a.localeCompare(b) : countA - countB
  })[0]!
}

function groupByPrimaryKeyword(
  extractedBehaviors: Readonly<Record<string, ExtractedBehavior>>,
): readonly KeywordBatch[] {
  const keywordCounts = new Map<string, number>()
  for (const behavior of Object.values(extractedBehaviors)) {
    for (const keyword of behavior.keywords) {
      const existingCount = keywordCounts.get(keyword)
      keywordCounts.set(keyword, existingCount === undefined ? 1 : existingCount + 1)
    }
  }

  const grouped = new Map<string, ConsolidateBehaviorInput[]>()
  for (const [testKey, behavior] of Object.entries(extractedBehaviors)) {
    const primaryKeyword = getPrimaryKeyword(behavior.keywords, keywordCounts)
    const existing = grouped.get(primaryKeyword)
    let inputs: readonly ConsolidateBehaviorInput[] = []
    if (existing !== undefined) {
      inputs = existing
    }
    const testFilePath = testKey.split('::')[0]
    let domain = ''
    if (testFilePath !== undefined) {
      domain = testFilePath
    }
    grouped.set(primaryKeyword, [
      ...inputs,
      {
        testKey,
        behavior: behavior.behavior,
        context: behavior.context,
        keywords: behavior.keywords,
        primaryKeyword,
        domain: getDomain(domain),
      },
    ])
  }

  return [...grouped.entries()].map(([batchKey, inputs]) => ({ batchKey, primaryKeyword: batchKey, inputs }))
}

function getSecondaryKeyword(input: ConsolidateBehaviorInput, primaryKeyword: string): string {
  const secondaryKeywordCandidate = input.keywords.find((keyword) => keyword !== primaryKeyword)
  if (secondaryKeywordCandidate === undefined) {
    return '__no_secondary__'
  }
  return secondaryKeywordCandidate
}

function groupInputsBySecondaryKeyword(group: KeywordBatch): Map<string, ConsolidateBehaviorInput[]> {
  return group.inputs.reduce((acc, input) => {
    const secondaryKeyword = getSecondaryKeyword(input, group.primaryKeyword)
    const existing = acc.get(secondaryKeyword)
    if (existing === undefined) {
      acc.set(secondaryKeyword, [input])
      return acc
    }
    existing.push(input)
    return acc
  }, new Map<string, ConsolidateBehaviorInput[]>())
}

function splitChunkedKeywordInputs(
  group: KeywordBatch,
  secondaryKeyword: string,
  inputs: readonly ConsolidateBehaviorInput[],
): readonly KeywordBatch[] {
  const batches: KeywordBatch[] = []
  inputs.forEach((input, index) => {
    const batchIndex = Math.floor(index / MAX_BATCH_SIZE)
    const existingBatch = batches[batchIndex]
    if (existingBatch === undefined) {
      batches.push({
        batchKey: `${group.batchKey}::${secondaryKeyword}::${batchIndex + 1}`,
        primaryKeyword: group.primaryKeyword,
        inputs: [input],
      })
      return
    }

    batches[batchIndex] = { ...existingBatch, inputs: [...existingBatch.inputs, input] }
  })
  return batches
}

function splitSecondaryKeywordGroup(
  group: KeywordBatch,
  secondaryKeyword: string,
  inputs: readonly ConsolidateBehaviorInput[],
): readonly KeywordBatch[] {
  if (inputs.length <= MAX_BATCH_SIZE) {
    return [
      {
        batchKey: `${group.batchKey}::${secondaryKeyword}`,
        primaryKeyword: group.primaryKeyword,
        inputs,
      },
    ]
  }
  return splitChunkedKeywordInputs(group, secondaryKeyword, inputs)
}

function partitionOversizedBatch(group: KeywordBatch): readonly KeywordBatch[] {
  if (group.inputs.length <= MAX_BATCH_SIZE) {
    return [group]
  }

  const secondaryKeywordGroups = groupInputsBySecondaryKeyword(group)

  return [...secondaryKeywordGroups.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .flatMap(([secondaryKeyword, inputs]) => splitSecondaryKeywordGroup(group, secondaryKeyword, inputs))
}

function buildConsolidations(
  result: Awaited<ReturnType<typeof consolidateWithRetry>>,
  sourceDomains: readonly string[],
): ConsolidatedBehavior[] {
  const domain = sourceDomains.length === 1 ? sourceDomains[0]! : 'cross-domain'
  return result!.map(({ id, item }) => ({
    id,
    domain,
    featureName: item.featureName,
    isUserFacing: item.isUserFacing,
    behavior: item.behavior,
    userStory: item.userStory,
    context: item.context,
    sourceTestKeys: item.sourceTestKeys,
  }))
}

function applyConsolidationsToManifest(
  consolidations: ConsolidatedBehavior[],
  inputs: readonly ConsolidateBehaviorInput[],
  primaryKeyword: string,
  sourceDomains: readonly string[],
  fingerprint: string,
  currentEntries: ConsolidatedManifest['entries'],
): ConsolidatedManifest['entries'] {
  const updatedEntries = { ...currentEntries }
  for (const cb of consolidations) {
    updatedEntries[cb.id] = {
      consolidatedId: cb.id,
      domain: cb.domain,
      featureName: cb.featureName,
      sourceTestKeys: cb.sourceTestKeys,
      isUserFacing: cb.isUserFacing,
      primaryKeyword,
      keywords: [...new Set(inputs.flatMap((input) => input.keywords))].toSorted(),
      sourceDomains,
      phase2Fingerprint: fingerprint,
      lastConsolidatedAt: new Date().toISOString(),
    }
  }
  return updatedEntries
}

async function consolidateBatch(
  group: KeywordBatch,
  idx: number,
  total: number,
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
): Promise<ConsolidatedManifest> {
  const { batchKey, primaryKeyword, inputs } = group
  const shouldSkipCompletedBatch = progress.phase2.status === 'done' && isBatchCompleted(progress, batchKey)
  if (shouldSkipCompletedBatch) {
    console.log(`[Phase 2] [${idx}/${total}] ${batchKey} — skipped (already done)`)
    return consolidatedManifest
  }
  const failedAttempts = getFailedBatchAttempts(progress, batchKey)
  if (failedAttempts >= MAX_RETRIES) {
    console.log(`[Phase 2] [${idx}/${total}] ${batchKey} — skipped (max retries exceeded)`)
    return consolidatedManifest
  }
  console.log(`[Phase 2] [${idx}/${total}] ${batchKey} (${inputs.length} behaviors)...`)
  const result = await consolidateWithRetry(primaryKeyword, inputs, failedAttempts)
  if (result === null) {
    markBatchFailed(progress, batchKey, 'consolidation failed after retries', failedAttempts + 1)
    await saveProgress(progress)
    return consolidatedManifest
  }
  const fingerprint = buildPhase2ConsolidationFingerprint({
    sourceTestKeys: inputs.map((i) => i.testKey),
    behaviors: inputs.map((i) => i.behavior),
    phaseVersion: phase2Version,
  })
  const sourceDomains = [...new Set(inputs.map((i) => i.domain))].toSorted()
  const consolidations = buildConsolidations(result, sourceDomains)
  await writeConsolidatedFile(primaryKeyword, consolidations)
  markBatchDone(progress, batchKey, consolidations)
  const updatedEntries = applyConsolidationsToManifest(
    consolidations,
    inputs,
    primaryKeyword,
    sourceDomains,
    fingerprint,
    consolidatedManifest.entries,
  )
  const userFacingCount = consolidations.filter((b) => b.isUserFacing).length
  console.log(
    `[Phase 2] [${idx}/${total}] ${batchKey} — done (${consolidations.length} consolidated, ${userFacingCount} user-facing)`,
  )
  return { ...consolidatedManifest, entries: updatedEntries }
}

export async function runPhase2(
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
  ...selectedTestKeysArg: [] | [ReadonlySet<string>]
): Promise<ConsolidatedManifest> {
  console.log('\n[Phase 2] Grouping extracted behaviors by primary keyword...')
  const selectedKeys = selectedTestKeysArg[0]
  if (selectedKeys === undefined) {
    return runPhase2(progress, consolidatedManifest, phase2Version, new Set())
  }
  const extractedBehaviors = Object.fromEntries(
    Object.entries(progress.phase1.extractedBehaviors).filter(([testKey]) => {
      if (selectedKeys.size === 0) {
        return true
      }
      return selectedKeys.has(testKey)
    }),
  )
  const groups = groupByPrimaryKeyword(extractedBehaviors).flatMap((group) => partitionOversizedBatch(group))
  progress.phase2.status = 'in-progress'
  progress.phase2.stats.batchesTotal = groups.length

  resetPhase3(progress)
  await saveProgress(progress)

  console.log(`[Phase 2] Consolidating ${groups.length} keyword batches...\n`)

  const limit = pLimit(1)
  let currentManifest = consolidatedManifest
  await Promise.all(
    groups.map((group, i) =>
      limit(async () => {
        currentManifest = await consolidateBatch(group, i + 1, groups.length, progress, currentManifest, phase2Version)
      }),
    ),
  )

  progress.phase2.status = 'done'
  await saveProgress(progress)
  console.log(
    `\n[Phase 2 complete] ${progress.phase2.stats.batchesDone} batches consolidated, ${progress.phase2.stats.batchesFailed} failed`,
  )
  return currentManifest
}
