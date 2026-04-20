import pLimit from 'p-limit'

import { MAX_RETRIES } from './config.js'
import type { ConsolidateBehaviorInput } from './consolidate-agent.js'
import { consolidateWithRetry } from './consolidate-agent.js'
import { getDomain } from './domain-map.js'
import type { ConsolidatedManifest } from './incremental.js'
import { buildPhase2ConsolidationFingerprint } from './incremental.js'
import type { Progress } from './progress.js'
import {
  getFailedDomainAttempts,
  isDomainCompleted,
  markDomainDone,
  markDomainFailed,
  resetPhase3,
  saveProgress,
} from './progress.js'
import type { ConsolidatedBehavior, ExtractedBehavior } from './report-writer.js'
import { writeConsolidatedFile } from './report-writer.js'

interface DomainGroup {
  readonly domain: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
}

function groupByDomain(extractedBehaviors: Readonly<Record<string, ExtractedBehavior>>): readonly DomainGroup[] {
  const map = new Map<string, ConsolidateBehaviorInput[]>()
  for (const [testKey, behavior] of Object.entries(extractedBehaviors)) {
    const domain = getDomain(behavior.fullPath)
    let group = map.get(domain)
    if (group === undefined) {
      group = []
      map.set(domain, group)
    }
    group.push({ testKey, behavior: behavior.behavior, context: behavior.context })
  }
  return [...map.entries()].map(([domain, inputs]) => ({ domain, inputs }))
}

async function consolidateDomain(
  group: DomainGroup,
  idx: number,
  total: number,
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
): Promise<ConsolidatedManifest> {
  const { domain, inputs } = group

  if (isDomainCompleted(progress, domain)) {
    console.log(`[Phase 2] [${idx}/${total}] ${domain} — skipped (already done)`)
    return consolidatedManifest
  }

  const failedAttempts = getFailedDomainAttempts(progress, domain)
  if (failedAttempts >= MAX_RETRIES) {
    console.log(`[Phase 2] [${idx}/${total}] ${domain} — skipped (max retries exceeded)`)
    return consolidatedManifest
  }

  console.log(`[Phase 2] [${idx}/${total}] ${domain} (${inputs.length} behaviors)...`)

  const result = await consolidateWithRetry(domain, inputs, failedAttempts)

  if (result === null) {
    markDomainFailed(progress, domain, 'consolidation failed after retries', failedAttempts + 1)
    await saveProgress(progress)
    return consolidatedManifest
  }

  const behaviors: string[] = inputs.map((i) => i.behavior)
  const fingerprint = buildPhase2ConsolidationFingerprint({
    sourceTestKeys: inputs.map((i) => i.testKey),
    behaviors,
    phaseVersion: phase2Version,
  })

  const consolidations: ConsolidatedBehavior[] = result.map(({ id, item }) => ({
    id,
    domain,
    featureName: item.featureName,
    isUserFacing: item.isUserFacing,
    behavior: item.behavior,
    userStory: item.userStory ?? null,
    context: item.context,
    sourceTestKeys: item.sourceTestKeys,
  }))

  await writeConsolidatedFile(domain, consolidations)
  markDomainDone(progress, domain, consolidations)

  const updatedEntries = { ...consolidatedManifest.entries }
  for (const cb of consolidations) {
    updatedEntries[cb.id] = {
      consolidatedId: cb.id,
      domain: cb.domain,
      featureName: cb.featureName,
      sourceTestKeys: cb.sourceTestKeys,
      isUserFacing: cb.isUserFacing,
      phase2Fingerprint: fingerprint,
      lastConsolidatedAt: new Date().toISOString(),
    }
  }

  const userFacingCount = consolidations.filter((b) => b.isUserFacing).length
  console.log(
    `[Phase 2] [${idx}/${total}] ${domain} — done (${consolidations.length} consolidated, ${userFacingCount} user-facing)`,
  )

  return { ...consolidatedManifest, entries: updatedEntries }
}

export async function runPhase2(
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
): Promise<ConsolidatedManifest> {
  console.log('\n[Phase 2] Grouping extracted behaviors by domain...')
  const groups = groupByDomain(progress.phase1.extractedBehaviors)
  progress.phase2.status = 'in-progress'
  progress.phase2.stats.domainsTotal = groups.length

  resetPhase3(progress)
  await saveProgress(progress)

  console.log(`[Phase 2] Consolidating ${groups.length} domains...\n`)

  const limit = pLimit(1)
  let currentManifest = consolidatedManifest
  await Promise.all(
    groups.map((group, i) =>
      limit(async () => {
        currentManifest = await consolidateDomain(group, i + 1, groups.length, progress, currentManifest, phase2Version)
      }),
    ),
  )

  progress.phase2.status = 'done'
  await saveProgress(progress)
  console.log(
    `\n[Phase 2 complete] ${progress.phase2.stats.domainsDone} domains consolidated, ${progress.phase2.stats.domainsFailed} failed`,
  )
  return currentManifest
}
