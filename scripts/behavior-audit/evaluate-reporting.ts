import type { EvaluatedFeatureRecord } from './evaluated-store.js'
import type { Progress } from './progress.js'
import type { FailedItem } from './report-index-helpers.js'
import type { DomainSummary } from './report-index-helpers.js'
import { buildSummary, collectStoryEvaluations } from './report-rebuild-helpers.js'
import { writeIndexFile, writeStoryFile, type StoryEvaluation } from './report-writer.js'

type ConsolidatedStoryRecord = {
  readonly id: string
  readonly domain: string
  readonly featureName: string
  readonly isUserFacing: boolean
  readonly behavior: string
  readonly userStory: string | null
  readonly context: string
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
}

interface WriteReportsInput {
  readonly consolidatedByFeatureKey: ReadonlyMap<string, readonly ConsolidatedStoryRecord[]>
  readonly evaluatedByFeatureKey: ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>
  readonly progress: Progress
}

function buildFailedItems(progress: Progress): readonly FailedItem[] {
  return Object.entries(progress.phase3.failedConsolidatedIds).map(([consolidatedId, entry]) => ({
    testFile: consolidatedId,
    testName: consolidatedId,
    error: entry.error,
    attempts: entry.attempts,
  }))
}

async function writeStoryReports(evaluationsByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>): Promise<void> {
  await Promise.all(
    [...evaluationsByDomain.entries()].map(([domain, evaluations]) =>
      writeStoryFile(
        domain,
        [...evaluations].toSorted((a, b) => a.testName.localeCompare(b.testName)),
      ),
    ),
  )
}

function buildSummaries(
  evaluationsByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>,
): readonly DomainSummary[] {
  return [...evaluationsByDomain.entries()]
    .map(([domain, evaluations]) => buildSummary(domain, evaluations))
    .toSorted((a, b) => a.domain.localeCompare(b.domain))
}

export async function writeReports(input: WriteReportsInput): Promise<void> {
  const { evaluationsByDomain, flawFreq, improvementFreq } = collectStoryEvaluations({
    consolidatedByFeatureKey: input.consolidatedByFeatureKey,
    evaluatedByFeatureKey: input.evaluatedByFeatureKey,
  })
  await writeStoryReports(evaluationsByDomain)
  const summaries = buildSummaries(evaluationsByDomain)

  await writeIndexFile(
    summaries,
    input.progress.phase3.stats.consolidatedIdsDone,
    input.progress.phase3.stats.consolidatedIdsFailed,
    flawFreq,
    improvementFreq,
    buildFailedItems(input.progress),
  )
}
