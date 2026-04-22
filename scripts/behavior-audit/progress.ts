import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { ClassifiedBehavior } from './classified-store.js'
import { PROGRESS_PATH } from './config.js'
import { validateOrMigrateProgress } from './progress-migrate.js'
import type { ConsolidatedBehavior } from './report-writer.js'
import type { EvaluatedBehavior } from './report-writer.js'
import type { ExtractedBehavior } from './report-writer.js'

export type PhaseStatus = 'not-started' | 'in-progress' | 'done'

export interface FailedEntry {
  readonly error: string
  readonly attempts: number
  readonly lastAttempt: string
}

export interface Phase1Progress {
  status: PhaseStatus
  completedTests: Record<string, Record<string, 'done'>>
  extractedBehaviors: Record<string, ExtractedBehavior>
  failedTests: Record<string, FailedEntry>
  completedFiles: string[]
  stats: { filesTotal: number; filesDone: number; testsExtracted: number; testsFailed: number }
}

export interface Phase2aProgress {
  status: PhaseStatus
  completedBehaviors: Record<string, 'done'>
  classifiedBehaviors: Record<string, ClassifiedBehavior>
  failedBehaviors: Record<string, FailedEntry>
  stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
}

export interface Phase2bProgress {
  status: PhaseStatus
  completedCandidateFeatures: Record<string, 'done'>
  consolidations: Record<string, readonly ConsolidatedBehavior[]>
  failedCandidateFeatures: Record<string, FailedEntry>
  stats: {
    candidateFeaturesTotal: number
    candidateFeaturesDone: number
    candidateFeaturesFailed: number
    behaviorsConsolidated: number
  }
}

export interface Phase3Progress {
  status: PhaseStatus
  completedBehaviors: Record<string, 'done'>
  evaluations: Record<string, EvaluatedBehavior>
  failedBehaviors: Record<string, FailedEntry>
  stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
}

export interface Progress {
  version: 3
  startedAt: string
  phase1: Phase1Progress
  phase2a: Phase2aProgress
  phase2b: Phase2bProgress
  phase3: Phase3Progress
}

export function emptyPhase2a(): Phase2aProgress {
  return {
    status: 'not-started',
    completedBehaviors: {},
    classifiedBehaviors: {},
    failedBehaviors: {},
    stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
  }
}

export function emptyPhase2b(): Phase2bProgress {
  return {
    status: 'not-started',
    completedCandidateFeatures: {},
    consolidations: {},
    failedCandidateFeatures: {},
    stats: {
      candidateFeaturesTotal: 0,
      candidateFeaturesDone: 0,
      candidateFeaturesFailed: 0,
      behaviorsConsolidated: 0,
    },
  }
}

export function emptyPhase3(): Phase3Progress {
  return {
    status: 'not-started',
    completedBehaviors: {},
    evaluations: {},
    failedBehaviors: {},
    stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
  }
}

export function createEmptyProgress(filesTotal: number): Progress {
  return {
    version: 3,
    startedAt: new Date().toISOString(),
    phase1: {
      status: 'not-started',
      completedTests: {},
      extractedBehaviors: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
    phase2a: emptyPhase2a(),
    phase2b: emptyPhase2b(),
    phase3: emptyPhase3(),
  }
}

export async function loadProgress(): Promise<Progress | null> {
  try {
    const text = await Bun.file(PROGRESS_PATH).text()
    return validateOrMigrateProgress(JSON.parse(text))
  } catch {
    return null
  }
}

export async function saveProgress(progress: Progress): Promise<void> {
  await mkdir(dirname(PROGRESS_PATH), { recursive: true })
  await Bun.write(PROGRESS_PATH, JSON.stringify(progress, null, 2) + '\n')
}

export function isFileCompleted(progress: Progress, filePath: string): boolean {
  return progress.phase1.completedFiles.includes(filePath)
}

function ensureCompletedTestsForFile(progress: Progress, filePath: string): Record<string, 'done'> {
  const existing = progress.phase1.completedTests[filePath]
  if (existing !== undefined) return existing
  const created: Record<string, 'done'> = {}
  progress.phase1.completedTests[filePath] = created
  return created
}

export function markTestDone(progress: Progress, filePath: string, testKey: string, behavior: ExtractedBehavior): void {
  const completedTests = ensureCompletedTestsForFile(progress, filePath)
  progress.phase1.extractedBehaviors[testKey] = behavior
  if (completedTests[testKey] === 'done') return
  completedTests[testKey] = 'done'
  progress.phase1.stats.testsExtracted++
}

export function markTestFailed(progress: Progress, testKey: string, error: string): void {
  const existing = progress.phase1.failedTests[testKey]
  const attempts = existing === undefined ? 0 : existing.attempts
  progress.phase1.failedTests[testKey] = {
    error,
    attempts: attempts + 1,
    lastAttempt: new Date().toISOString(),
  }
  progress.phase1.stats.testsFailed++
}

export function markFileDone(progress: Progress, filePath: string): void {
  if (progress.phase1.completedFiles.includes(filePath)) return
  progress.phase1.completedFiles.push(filePath)
  progress.phase1.stats.filesDone++
}

export function getFailedTestAttempts(progress: Progress, testKey: string): number {
  return progress.phase1.failedTests[testKey]?.attempts ?? 0
}

export function markClassificationDone(progress: Progress, behaviorId: string, classified: ClassifiedBehavior): void {
  const hadFailedState = progress.phase2a.failedBehaviors[behaviorId] !== undefined
  if (hadFailedState) {
    const { [behaviorId]: _removed, ...remainingFailedBehaviors } = progress.phase2a.failedBehaviors
    progress.phase2a.failedBehaviors = remainingFailedBehaviors
    progress.phase2a.stats.behaviorsFailed = Math.max(0, progress.phase2a.stats.behaviorsFailed - 1)
  }

  if (progress.phase2a.completedBehaviors[behaviorId] === 'done') {
    progress.phase2a.classifiedBehaviors[behaviorId] = classified
    return
  }
  progress.phase2a.completedBehaviors[behaviorId] = 'done'
  progress.phase2a.classifiedBehaviors[behaviorId] = classified
  progress.phase2a.stats.behaviorsDone++
}

export function markClassificationFailed(progress: Progress, behaviorId: string, error: string): void {
  const existing = progress.phase2a.failedBehaviors[behaviorId]
  const attempts = existing === undefined ? 0 : existing.attempts
  progress.phase2a.failedBehaviors[behaviorId] = {
    error,
    attempts: attempts + 1,
    lastAttempt: new Date().toISOString(),
  }
  if (existing === undefined) {
    progress.phase2a.stats.behaviorsFailed++
  }
}

export function setClassificationFailedAttempts(
  progress: Progress,
  behaviorId: string,
  error: string,
  attempts: number,
): void {
  const existing = progress.phase2a.failedBehaviors[behaviorId]
  progress.phase2a.failedBehaviors[behaviorId] = {
    error,
    attempts,
    lastAttempt: new Date().toISOString(),
  }
  if (existing === undefined) {
    progress.phase2a.stats.behaviorsFailed++
  }
}

export function getFailedClassificationAttempts(progress: Progress, behaviorId: string): number {
  return progress.phase2a.failedBehaviors[behaviorId]?.attempts ?? 0
}

export function markCandidateFeatureDone(
  progress: Progress,
  candidateFeatureKey: string,
  consolidations: readonly ConsolidatedBehavior[],
): void {
  if (progress.phase2b.completedCandidateFeatures[candidateFeatureKey] === 'done') return
  progress.phase2b.completedCandidateFeatures[candidateFeatureKey] = 'done'
  progress.phase2b.consolidations[candidateFeatureKey] = consolidations
  progress.phase2b.stats.candidateFeaturesDone++
  progress.phase2b.stats.behaviorsConsolidated += consolidations.length
}

export function isBatchCompleted(progress: Progress, batchKey: string): boolean {
  return progress.phase2b.completedCandidateFeatures[batchKey] === 'done'
}

export function markBatchDone(
  progress: Progress,
  batchKey: string,
  consolidations: readonly ConsolidatedBehavior[],
): void {
  markCandidateFeatureDone(progress, batchKey, consolidations)
}

export function markBatchFailed(progress: Progress, batchKey: string, error: string, attempts: number): void {
  progress.phase2b.failedCandidateFeatures[batchKey] = { error, attempts, lastAttempt: new Date().toISOString() }
  progress.phase2b.stats.candidateFeaturesFailed++
}

export function getFailedBatchAttempts(progress: Progress, batchKey: string): number {
  return progress.phase2b.failedCandidateFeatures[batchKey]?.attempts ?? 0
}

export function isBehaviorCompleted(progress: Progress, key: string): boolean {
  return progress.phase3.completedBehaviors[key] === 'done'
}

export function markBehaviorDone(progress: Progress, key: string, evaluation: EvaluatedBehavior): void {
  if (progress.phase3.completedBehaviors[key] === 'done') return
  progress.phase3.completedBehaviors[key] = 'done'
  progress.phase3.evaluations[key] = evaluation
  progress.phase3.stats.behaviorsDone++
}

export function markBehaviorFailed(progress: Progress, key: string, error: string, attempts: number): void {
  progress.phase3.failedBehaviors[key] = { error, attempts, lastAttempt: new Date().toISOString() }
  progress.phase3.stats.behaviorsFailed++
}

export function getFailedBehaviorAttempts(progress: Progress, key: string): number {
  return progress.phase3.failedBehaviors[key]?.attempts ?? 0
}

export function resetPhase2AndPhase3(progress: Progress): void {
  progress.phase2a = emptyPhase2a()
  progress.phase2b = emptyPhase2b()
  progress.phase3 = emptyPhase3()
}

export function resetPhase2bAndPhase3(progress: Progress): void {
  progress.phase2b = emptyPhase2b()
  progress.phase3 = emptyPhase3()
}

export function resetPhase3(progress: Progress): void {
  progress.phase3 = emptyPhase3()
}
