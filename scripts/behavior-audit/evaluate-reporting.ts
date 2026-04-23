import type { EvaluatedFeatureRecord } from './evaluated-store.js'
import type { ConsolidatedManifest } from './incremental.js'
import type { Progress } from './progress.js'
import type { DomainSummary, FailedItem } from './report-index-helpers.js'
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
  readonly consolidatedManifest: ConsolidatedManifest
  readonly consolidatedByFeatureKey: ReadonlyMap<string, readonly ConsolidatedStoryRecord[]>
  readonly evaluatedByFeatureKey: ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>
  readonly progress: Progress
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function toStoryEvaluation(input: {
  readonly featureName: string
  readonly behavior: string
  readonly userStory: string
  readonly evaluation: EvaluatedFeatureRecord
}): StoryEvaluation {
  return {
    testName: input.featureName,
    behavior: input.behavior,
    userStory: input.userStory,
    maria: input.evaluation.maria,
    dani: input.evaluation.dani,
    viktor: input.evaluation.viktor,
    flaws: input.evaluation.flaws,
    improvements: input.evaluation.improvements,
  }
}

function buildSummary(domain: string, evaluations: readonly StoryEvaluation[]): DomainSummary {
  const avg = (fn: (evaluation: StoryEvaluation) => number): number =>
    evaluations.reduce((sum, evaluation) => sum + fn(evaluation), 0) / evaluations.length
  const personaAverage = (persona: 'maria' | 'dani' | 'viktor'): number =>
    avg((evaluation) => (evaluation[persona].discover + evaluation[persona].use + evaluation[persona].retain) / 3)
  const personaScores: ReadonlyArray<readonly [string, number]> = [
    ['Maria', personaAverage('maria')],
    ['Dani', personaAverage('dani')],
    ['Viktor', personaAverage('viktor')],
  ]
  const worstPersona = personaScores.reduce((min, item) => (item[1] < min[1] ? item : min))

  return {
    domain,
    count: evaluations.length,
    avgDiscover: avg(
      (evaluation) => (evaluation.maria.discover + evaluation.dani.discover + evaluation.viktor.discover) / 3,
    ),
    avgUse: avg((evaluation) => (evaluation.maria.use + evaluation.dani.use + evaluation.viktor.use) / 3),
    avgRetain: avg((evaluation) => (evaluation.maria.retain + evaluation.dani.retain + evaluation.viktor.retain) / 3),
    worstPersona: `${worstPersona[0]} (${worstPersona[1].toFixed(1)})`,
  }
}

function buildFailedItems(progress: Progress): readonly FailedItem[] {
  return Object.entries(progress.phase3.failedConsolidatedIds).map(([consolidatedId, entry]) => ({
    testFile: consolidatedId,
    testName: consolidatedId,
    error: entry.error,
    attempts: entry.attempts,
  }))
}

function collectStoryEvaluations(
  input: Pick<WriteReportsInput, 'consolidatedByFeatureKey' | 'evaluatedByFeatureKey'>,
): {
  readonly evaluationsByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>
  readonly flawFreq: ReadonlyMap<string, number>
  readonly improvementFreq: ReadonlyMap<string, number>
} {
  const evaluationsByDomain = new Map<string, StoryEvaluation[]>()
  const flawFreq = new Map<string, number>()
  const improvementFreq = new Map<string, number>()

  for (const [featureKey, evaluations] of input.evaluatedByFeatureKey.entries()) {
    const consolidatedRecords = input.consolidatedByFeatureKey.get(featureKey) ?? []
    const consolidatedById = new Map(consolidatedRecords.map((record) => [record.id, record]))

    for (const evaluation of evaluations) {
      const consolidated = consolidatedById.get(evaluation.consolidatedId)
      if (consolidated === undefined || consolidated.userStory === null || !consolidated.isUserFacing) {
        continue
      }

      const storyEvaluation = toStoryEvaluation({
        featureName: consolidated.featureName,
        behavior: consolidated.behavior,
        userStory: consolidated.userStory,
        evaluation,
      })
      evaluationsByDomain.set(consolidated.domain, [
        ...(evaluationsByDomain.get(consolidated.domain) ?? []),
        storyEvaluation,
      ])
      for (const flaw of storyEvaluation.flaws) incrementCount(flawFreq, flaw)
      for (const improvement of storyEvaluation.improvements) incrementCount(improvementFreq, improvement)
    }
  }

  return { evaluationsByDomain, flawFreq, improvementFreq }
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
  void input.consolidatedManifest
  const { evaluationsByDomain, flawFreq, improvementFreq } = collectStoryEvaluations(input)
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
