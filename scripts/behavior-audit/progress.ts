import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { ClassifiedBehavior } from './classified-store.js'
import { PROGRESS_PATH } from './config.js'
import { validateOrMigrateProgress } from './progress-migrate.js'
import type { ConsolidatedBehavior } from './report-writer.js'
import type { StoryEvaluation } from './report-writer.js'

export type PhaseStatus = 'not-started' | 'in-progress' | 'done'

export interface FailedEntry {
  readonly error: string
  readonly attempts: number
  readonly lastAttempt: string
}

export interface Phase1Progress {
  status: PhaseStatus
  completedTests: Record<string, Record<string, 'done'>>
  failedTests: Record<string, FailedEntry>
  completedFiles: string[]
  stats: { filesTotal: number; filesDone: number; testsExtracted: number; testsFailed: number }
}

export interface Phase2aProgress {
  status: PhaseStatus
  completedBehaviors: Record<string, 'done'>
  failedBehaviors: Record<string, FailedEntry>
  stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
}

export interface Phase2bProgress {
  status: PhaseStatus
  completedFeatureKeys: Record<string, 'done'>
  failedFeatureKeys: Record<string, FailedEntry>
  stats: {
    featureKeysTotal: number
    featureKeysDone: number
    featureKeysFailed: number
    behaviorsConsolidated: number
  }
}

export interface Phase3Progress {
  status: PhaseStatus
  completedConsolidatedIds: Record<string, 'done'>
  failedConsolidatedIds: Record<string, FailedEntry>
  stats: {
    consolidatedIdsTotal: number
    consolidatedIdsDone: number
    consolidatedIdsFailed: number
  }
}

export interface Progress {
  version: 4
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
    failedBehaviors: {},
    stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
  }
}

export function emptyPhase2b(): Phase2bProgress {
  return {
    status: 'not-started',
    completedFeatureKeys: {},
    failedFeatureKeys: {},
    stats: {
      featureKeysTotal: 0,
      featureKeysDone: 0,
      featureKeysFailed: 0,
      behaviorsConsolidated: 0,
    },
  }
}

export function emptyPhase3(): Phase3Progress {
  return {
    status: 'not-started',
    completedConsolidatedIds: {},
    failedConsolidatedIds: {},
    stats: { consolidatedIdsTotal: 0, consolidatedIdsDone: 0, consolidatedIdsFailed: 0 },
  }
}

export function createEmptyProgress(filesTotal: number): Progress {
  return {
    version: 4,
    startedAt: new Date().toISOString(),
    phase1: {
      status: 'not-started',
      completedTests: {},
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
  const file = Bun.file(PROGRESS_PATH)
  if (!(await file.exists())) {
    return null
  }

  const text = await file.text()
  const progress = validateOrMigrateProgress(JSON.parse(text))
  if (progress === null) {
    throw new Error('Invalid behavior-audit progress file')
  }
  return progress
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

export function markTestDone(progress: Progress, filePath: string, testKey: string): void {
  const completedTests = ensureCompletedTestsForFile(progress, filePath)
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
  void classified
  const hadFailedState = progress.phase2a.failedBehaviors[behaviorId] !== undefined
  if (hadFailedState) {
    const { [behaviorId]: _removed, ...remainingFailedBehaviors } = progress.phase2a.failedBehaviors
    progress.phase2a.failedBehaviors = remainingFailedBehaviors
    progress.phase2a.stats.behaviorsFailed = Math.max(0, progress.phase2a.stats.behaviorsFailed - 1)
  }

  if (progress.phase2a.completedBehaviors[behaviorId] === 'done') return
  progress.phase2a.completedBehaviors[behaviorId] = 'done'
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
  if (progress.phase2b.completedFeatureKeys[candidateFeatureKey] === 'done') return
  progress.phase2b.completedFeatureKeys[candidateFeatureKey] = 'done'
  progress.phase2b.stats.featureKeysDone++
  progress.phase2b.stats.behaviorsConsolidated += consolidations.length
}

export function isBatchCompleted(progress: Progress, batchKey: string): boolean {
  return progress.phase2b.completedFeatureKeys[batchKey] === 'done'
}

export function markBatchDone(
  progress: Progress,
  batchKey: string,
  consolidations: readonly ConsolidatedBehavior[],
): void {
  markCandidateFeatureDone(progress, batchKey, consolidations)
}

export function markBatchFailed(progress: Progress, batchKey: string, error: string, attempts: number): void {
  const existing = progress.phase2b.failedFeatureKeys[batchKey]
  progress.phase2b.failedFeatureKeys[batchKey] = { error, attempts, lastAttempt: new Date().toISOString() }
  if (existing === undefined) {
    progress.phase2b.stats.featureKeysFailed++
  }
}

export function getFailedBatchAttempts(progress: Progress, batchKey: string): number {
  return progress.phase2b.failedFeatureKeys[batchKey]?.attempts ?? 0
}

export function isBehaviorCompleted(progress: Progress, key: string): boolean {
  return progress.phase3.completedConsolidatedIds[key] === 'done'
}

export function markBehaviorDone(progress: Progress, key: string, evaluation: StoryEvaluation): void {
  void evaluation
  if (progress.phase3.completedConsolidatedIds[key] === 'done') return
  progress.phase3.completedConsolidatedIds[key] = 'done'
  progress.phase3.stats.consolidatedIdsDone++
}

export function markBehaviorFailed(progress: Progress, key: string, error: string, attempts: number): void {
  const existing = progress.phase3.failedConsolidatedIds[key]
  progress.phase3.failedConsolidatedIds[key] = { error, attempts, lastAttempt: new Date().toISOString() }
  if (existing === undefined) {
    progress.phase3.stats.consolidatedIdsFailed++
  }
}

export function getFailedBehaviorAttempts(progress: Progress, key: string): number {
  return progress.phase3.failedConsolidatedIds[key]?.attempts ?? 0
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
