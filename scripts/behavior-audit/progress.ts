import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { PROGRESS_PATH } from './config.js'

type PhaseStatus = 'not-started' | 'in-progress' | 'done'

interface FailedEntry {
  readonly error: string
  readonly attempts: number
  readonly lastAttempt: string
}

interface Phase1Progress {
  status: PhaseStatus
  completedTests: Record<string, Record<string, 'done'>>
  failedTests: Record<string, FailedEntry>
  completedFiles: string[]
  stats: { filesTotal: number; filesDone: number; testsExtracted: number; testsFailed: number }
}

interface Phase2Progress {
  status: PhaseStatus
  completedBehaviors: Record<string, 'done'>
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
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
    phase2: {
      status: 'not-started',
      completedBehaviors: {},
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
  if (hasProgressShape(raw)) return raw
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

export function markTestDone(progress: Progress, filePath: string, testKey: string): void {
  progress.phase1.completedTests[filePath] ??= {}
  progress.phase1.completedTests[filePath][testKey] = 'done'
  progress.phase1.stats.testsExtracted++
}

export function markTestFailed(progress: Progress, testKey: string, error: string): void {
  const existing = progress.phase1.failedTests[testKey]
  progress.phase1.failedTests[testKey] = {
    error,
    attempts: (existing?.attempts ?? 0) + 1,
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

export function markBehaviorDone(progress: Progress, behaviorKey: string): void {
  progress.phase2.completedBehaviors[behaviorKey] = 'done'
  progress.phase2.stats.behaviorsDone++
}

export function markBehaviorFailed(progress: Progress, behaviorKey: string, error: string): void {
  const existing = progress.phase2.failedBehaviors[behaviorKey]
  progress.phase2.failedBehaviors[behaviorKey] = {
    error,
    attempts: (existing?.attempts ?? 0) + 1,
    lastAttempt: new Date().toISOString(),
  }
  progress.phase2.stats.behaviorsFailed++
}

export function isBehaviorCompleted(progress: Progress, behaviorKey: string): boolean {
  return progress.phase2.completedBehaviors[behaviorKey] === 'done'
}

export function getFailedTestAttempts(progress: Progress, testKey: string): number {
  return progress.phase1.failedTests[testKey]?.attempts ?? 0
}

export function getFailedBehaviorAttempts(progress: Progress, behaviorKey: string): number {
  return progress.phase2.failedBehaviors[behaviorKey]?.attempts ?? 0
}
