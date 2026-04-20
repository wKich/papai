import type { EvalResult } from './evaluate-agent.js'
import type { Progress } from './progress.js'
import type { EvaluatedBehavior } from './report-writer.js'
import { writeIndexFile, writeStoryFile } from './report-writer.js'

function getExistingEvaluations(
  evaluationsByDomain: ReadonlyMap<string, EvaluatedBehavior[]>,
  domain: string,
): readonly EvaluatedBehavior[] {
  const existing = evaluationsByDomain.get(domain)
  if (existing === undefined) return []
  return existing
}

function incrementCount(map: Map<string, number>, key: string): void {
  const existing = map.get(key)
  map.set(key, existing === undefined ? 1 : existing + 1)
}

export function recordEval(
  evalResult: EvalResult,
  input: {
    readonly domain: string
    readonly featureName: string
    readonly behavior: string
    readonly userStory: string
  },
  evaluationsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
): void {
  const evaluated: EvaluatedBehavior = {
    testName: input.featureName,
    behavior: input.behavior,
    userStory: input.userStory,
    maria: evalResult.maria,
    dani: evalResult.dani,
    viktor: evalResult.viktor,
    flaws: evalResult.flaws,
    improvements: evalResult.improvements,
  }
  evaluationsByDomain.set(input.domain, [...getExistingEvaluations(evaluationsByDomain, input.domain), evaluated])
  for (const flaw of evalResult.flaws) incrementCount(flawFreq, flaw)
  for (const improvement of evalResult.improvements) incrementCount(impFreq, improvement)
}

export function recordStoredEvaluation(
  evaluation: EvaluatedBehavior,
  domain: string,
  evaluationsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
): void {
  evaluationsByDomain.set(domain, [...getExistingEvaluations(evaluationsByDomain, domain), evaluation])
  for (const flaw of evaluation.flaws) incrementCount(flawFreq, flaw)
  for (const improvement of evaluation.improvements) incrementCount(impFreq, improvement)
}

function buildSummary(
  domain: string,
  evals: readonly EvaluatedBehavior[],
): {
  readonly domain: string
  readonly count: number
  readonly avgDiscover: number
  readonly avgUse: number
  readonly avgRetain: number
  readonly worstPersona: string
} {
  const avg = (fn: (evaluation: EvaluatedBehavior) => number): number =>
    evals.reduce((sum, evaluation) => sum + fn(evaluation), 0) / evals.length
  const pAvg = (persona: 'maria' | 'dani' | 'viktor'): number =>
    avg((evaluation) => (evaluation[persona].discover + evaluation[persona].use + evaluation[persona].retain) / 3)
  const personaScores: ReadonlyArray<readonly [string, number]> = [
    ['Maria', pAvg('maria')],
    ['Dani', pAvg('dani')],
    ['Viktor', pAvg('viktor')],
  ]
  const worst = personaScores.reduce((min, cur) => (cur[1] < min[1] ? cur : min))
  return {
    domain,
    count: evals.length,
    avgDiscover: avg(
      (evaluation) => (evaluation.maria.discover + evaluation.dani.discover + evaluation.viktor.discover) / 3,
    ),
    avgUse: avg((evaluation) => (evaluation.maria.use + evaluation.dani.use + evaluation.viktor.use) / 3),
    avgRetain: avg((evaluation) => (evaluation.maria.retain + evaluation.dani.retain + evaluation.viktor.retain) / 3),
    worstPersona: `${worst[0]} (${worst[1].toFixed(1)})`,
  }
}

export async function writeReports(
  evaluationsByDomain: ReadonlyMap<string, EvaluatedBehavior[]>,
  flawFreq: ReadonlyMap<string, number>,
  impFreq: ReadonlyMap<string, number>,
  progress: Progress,
): Promise<void> {
  await Promise.all(
    [...evaluationsByDomain.entries()].map(([domain, evaluations]) => writeStoryFile(domain, evaluations)),
  )
  const summaries = [...evaluationsByDomain.entries()].map(([domain, evaluations]) => buildSummary(domain, evaluations))
  const failedItems = Object.entries(progress.phase3.failedBehaviors).map(([key, entry]) => ({
    testFile: key.split('::')[0] ?? 'unknown',
    testName: key.split('::').slice(1).join('::'),
    error: entry.error,
    attempts: entry.attempts,
  }))
  await writeIndexFile(
    summaries,
    progress.phase3.stats.behaviorsDone,
    progress.phase3.stats.behaviorsFailed,
    flawFreq,
    impFreq,
    failedItems,
  )
}
