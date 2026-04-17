import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { PROGRESS_PATH } from './config.js'
import type { ExtractedBehavior, EvaluatedBehavior } from './report-writer.js'

type PhaseStatus = 'not-started' | 'in-progress' | 'done'

interface FailedEntry {
  readonly error: string
  readonly attempts: number
  readonly lastAttempt: string
}

interface Phase1Progress {
  status: PhaseStatus
  completedTests: Record<string, Record<string, 'done'>>
  extractedBehaviors: Record<string, ExtractedBehavior>
  failedTests: Record<string, FailedEntry>
  completedFiles: string[]
  stats: { filesTotal: number; filesDone: number; testsExtracted: number; testsFailed: number }
}

interface Phase2Progress {
  status: PhaseStatus
  completedBehaviors: Record<string, 'done'>
  evaluations: Record<string, EvaluatedBehavior>
  failedBehaviors: Record<string, FailedEntry>
  stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
}

export interface Progress {
  version: 1
  startedAt: string
  phase1: Phase1Progress
  phase2: Phase2Progress
}

export function createEmptyProgress(filesTotal: number): Progress {
  return {
    version: 1,
    startedAt: new Date().toISOString(),
    phase1: {
      status: 'not-started',
      completedTests: {},
      extractedBehaviors: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
    phase2: {
      status: 'not-started',
      completedBehaviors: {},
      evaluations: {},
      failedBehaviors: {},
      stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
    },
  }
}

function hasProgressShape(raw: unknown): raw is Progress {
  if (typeof raw !== 'object' || raw === null) return false
  return 'startedAt' in raw && 'phase1' in raw && 'phase2' in raw
}

function validateProgress(raw: unknown): Progress | null {
  if (hasProgressShape(raw)) {
    const extractedBehaviors =
      'extractedBehaviors' in raw.phase1 && raw.phase1.extractedBehaviors !== undefined
        ? raw.phase1.extractedBehaviors
        : {}
    const evaluations =
      'evaluations' in raw.phase2 && raw.phase2.evaluations !== undefined ? raw.phase2.evaluations : {}
    return {
      ...raw,
      phase1: {
        ...raw.phase1,
        extractedBehaviors,
      },
      phase2: {
        ...raw.phase2,
        evaluations,
      },
    }
  }
  return null
}

export async function loadProgress(): Promise<Progress | null> {
  try {
    const text = await Bun.file(PROGRESS_PATH).text()
    return validateProgress(JSON.parse(text))
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
  if (!progress.phase1.completedFiles.includes(filePath)) {
    progress.phase1.completedFiles.push(filePath)
    progress.phase1.stats.filesDone++
  }
}

export function markBehaviorDone(progress: Progress, behaviorKey: string, evaluation: EvaluatedBehavior): void {
  progress.phase2.evaluations[behaviorKey] = evaluation
  if (progress.phase2.completedBehaviors[behaviorKey] === 'done') return
  progress.phase2.completedBehaviors[behaviorKey] = 'done'
  progress.phase2.stats.behaviorsDone++
}

export function markBehaviorFailed(progress: Progress, behaviorKey: string, error: string): void {
  const existing = progress.phase2.failedBehaviors[behaviorKey]
  const attempts = existing === undefined ? 0 : existing.attempts
  progress.phase2.failedBehaviors[behaviorKey] = {
    error,
    attempts: attempts + 1,
    lastAttempt: new Date().toISOString(),
  }
  progress.phase2.stats.behaviorsFailed++
}

export function isBehaviorCompleted(progress: Progress, behaviorKey: string): boolean {
  return progress.phase2.completedBehaviors[behaviorKey] === 'done'
}

export function getFailedTestAttempts(progress: Progress, testKey: string): number {
  const failed = progress.phase1.failedTests[testKey]
  return failed === undefined ? 0 : failed.attempts
}

export function getFailedBehaviorAttempts(progress: Progress, behaviorKey: string): number {
  const failed = progress.phase2.failedBehaviors[behaviorKey]
  return failed === undefined ? 0 : failed.attempts
}
