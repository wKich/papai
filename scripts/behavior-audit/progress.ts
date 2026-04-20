import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { PROGRESS_PATH } from './config.js'
import type { ConsolidatedBehavior } from './report-writer.js'
import type { EvaluatedBehavior } from './report-writer.js'

type PhaseStatus = 'not-started' | 'in-progress' | 'done'

interface FailedEntry {
  readonly error: string
  readonly attempts: number
  readonly lastAttempt: string
}

interface Phase1Progress {
  status: PhaseStatus
  completedTests: Record<string, Record<string, 'done'>>
  extractedBehaviors: Record<string, EvaluatedBehavior>
  failedTests: Record<string, FailedEntry>
  completedFiles: string[]
  stats: { filesTotal: number; filesDone: number; testsExtracted: number; testsFailed: number }
}

interface Phase2Progress {
  status: PhaseStatus
  completedDomains: Record<string, 'done'>
  consolidations: Record<string, readonly ConsolidatedBehavior[]>
  failedDomains: Record<string, FailedEntry>
  stats: { domainsTotal: number; domainsDone: number; domainsFailed: number; behaviorsConsolidated: number }
}

interface Phase3Progress {
  status: PhaseStatus
  completedBehaviors: Record<string, 'done'>
  evaluations: Record<string, EvaluatedBehavior>
  failedBehaviors: Record<string, FailedEntry>
  stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
}

export interface Progress {
  version: 2
  startedAt: string
  phase1: Phase1Progress
  phase2: Phase2Progress
  phase3: Phase3Progress
}

const Phase1StatsSchema = z.object({
  filesTotal: z.number(),
  filesDone: z.number(),
  testsExtracted: z.number(),
  testsFailed: z.number(),
})

const FailedEntrySchema = z.object({
  error: z.string(),
  attempts: z.number(),
  lastAttempt: z.string(),
})

const Phase1ProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedTests: z.record(z.string(), z.record(z.string(), z.literal('done'))),
  extractedBehaviors: z.record(z.string(), z.unknown()),
  failedTests: z.record(z.string(), FailedEntrySchema),
  completedFiles: z.array(z.string()),
  stats: Phase1StatsSchema,
})

const Phase2StatsSchema = z.object({
  domainsTotal: z.number(),
  domainsDone: z.number(),
  domainsFailed: z.number(),
  behaviorsConsolidated: z.number(),
})

const Phase2ProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedDomains: z.record(z.string(), z.literal('done')),
  consolidations: z.record(z.string(), z.unknown()),
  failedDomains: z.record(z.string(), FailedEntrySchema),
  stats: Phase2StatsSchema,
})

const Phase3StatsSchema = z.object({
  behaviorsTotal: z.number(),
  behaviorsDone: z.number(),
  behaviorsFailed: z.number(),
})

const Phase3ProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedBehaviors: z.record(z.string(), z.literal('done')),
  evaluations: z.record(z.string(), z.unknown()),
  failedBehaviors: z.record(z.string(), FailedEntrySchema),
  stats: Phase3StatsSchema,
})

const ProgressV2Schema = z.object({
  version: z.literal(2),
  startedAt: z.string(),
  phase1: Phase1ProgressSchema,
  phase2: Phase2ProgressSchema,
  phase3: Phase3ProgressSchema,
})

function emptyPhase2Stats(): Phase2Progress['stats'] {
  return { domainsTotal: 0, domainsDone: 0, domainsFailed: 0, behaviorsConsolidated: 0 }
}

function emptyPhase3Stats(): Phase3Progress['stats'] {
  return { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 }
}

function emptyPhase2(): Phase2Progress {
  return {
    status: 'not-started',
    completedDomains: {},
    consolidations: {},
    failedDomains: {},
    stats: emptyPhase2Stats(),
  }
}

function emptyPhase3(): Phase3Progress {
  return {
    status: 'not-started',
    completedBehaviors: {},
    evaluations: {},
    failedBehaviors: {},
    stats: emptyPhase3Stats(),
  }
}

function migratePhase3FromLegacy(raw: Record<string, unknown>): Phase3Progress {
  const legacyPhase2 = raw['phase2']
  if (typeof legacyPhase2 === 'object' && legacyPhase2 !== null && 'evaluations' in legacyPhase2) {
    const lp = legacyPhase2 as Record<string, unknown>
    return {
      status: (lp['status'] as PhaseStatus | undefined) ?? 'not-started',
      completedBehaviors: (lp['completedBehaviors'] as Record<string, 'done'> | undefined) ?? {},
      evaluations: (lp['evaluations'] as Record<string, EvaluatedBehavior> | undefined) ?? {},
      failedBehaviors: (lp['failedBehaviors'] as Record<string, FailedEntry> | undefined) ?? {},
      stats: (lp['stats'] as Phase3Progress['stats'] | undefined) ?? emptyPhase3Stats(),
    }
  }
  return emptyPhase3()
}

function migrateV1toV2(raw: unknown): Progress {
  const r = raw as Record<string, unknown>
  const phase1 = r['phase1'] as Phase1Progress
  const extractedBehaviors =
    typeof phase1['extractedBehaviors'] === 'object' && phase1['extractedBehaviors'] !== null
      ? phase1['extractedBehaviors']
      : {}
  return {
    version: 2,
    startedAt: (r['startedAt'] as string) ?? new Date().toISOString(),
    phase1: { ...phase1, extractedBehaviors },
    phase2: emptyPhase2(),
    phase3: migratePhase3FromLegacy(r),
  }
}

function validateOrMigrateProgress(raw: unknown): Progress | null {
  const v2Result = ProgressV2Schema.safeParse(raw)
  if (v2Result.success) return v2Result.data as unknown as Progress

  if (typeof raw === 'object' && raw !== null && 'startedAt' in raw && 'phase1' in raw) {
    return migrateV1toV2(raw)
  }

  return null
}

export function createEmptyProgress(filesTotal: number): Progress {
  return {
    version: 2,
    startedAt: new Date().toISOString(),
    phase1: {
      status: 'not-started',
      completedTests: {},
      extractedBehaviors: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
    phase2: emptyPhase2(),
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

export function markTestDone(progress: Progress, filePath: string, testKey: string, behavior: unknown): void {
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

export function isDomainCompleted(progress: Progress, domain: string): boolean {
  return progress.phase2.completedDomains[domain] === 'done'
}

export function markDomainDone(
  progress: Progress,
  domain: string,
  consolidations: readonly ConsolidatedBehavior[],
): void {
  if (progress.phase2.completedDomains[domain] === 'done') return
  progress.phase2.completedDomains[domain] = 'done'
  progress.phase2.consolidations[domain] = consolidations
  progress.phase2.stats.domainsDone++
  progress.phase2.stats.behaviorsConsolidated += consolidations.length
}

export function markDomainFailed(progress: Progress, domain: string, error: string, attempts: number): void {
  progress.phase2.failedDomains[domain] = { error, attempts, lastAttempt: new Date().toISOString() }
  progress.phase2.stats.domainsFailed++
}

export function getFailedDomainAttempts(progress: Progress, domain: string): number {
  return progress.phase2.failedDomains[domain]?.attempts ?? 0
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
  progress.phase2 = emptyPhase2()
  progress.phase3 = emptyPhase3()
}

export function resetPhase3(progress: Progress): void {
  progress.phase3 = emptyPhase3()
}
