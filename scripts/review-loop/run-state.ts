import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import type { ReviewLoopConfig } from './config.js'

export const RunStateSchema = z.object({
  runId: z.string(),
  runDir: z.string(),
  transcriptDir: z.string(),
  statePath: z.string(),
  reviewerSessionPath: z.string(),
  fixerSessionPath: z.string(),
  repoRoot: z.string(),
  planPath: z.string(),
  reviewerSessionId: z.string().nullable(),
  fixerSessionId: z.string().nullable(),
  currentRound: z.number().int().nonnegative(),
  noProgressRounds: z.number().int().nonnegative(),
})

export interface RunState {
  runId: string
  runDir: string
  transcriptDir: string
  statePath: string
  reviewerSessionPath: string
  fixerSessionPath: string
  repoRoot: string
  planPath: string
  reviewerSessionId: string | null
  fixerSessionId: string | null
  currentRound: number
  noProgressRounds: number
}

function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export async function createRunState(
  config: ReviewLoopConfig,
  planPath: string,
): Promise<RunState> {
  const runId = makeRunId()
  const runDir = path.join(config.workDir, 'runs', runId)
  const transcriptDir = path.join(runDir, 'transcripts')
  const statePath = path.join(runDir, 'state.json')
  const reviewerSessionPath = path.join(runDir, 'reviewer-session.json')
  const fixerSessionPath = path.join(runDir, 'fixer-session.json')

  await mkdir(transcriptDir, { recursive: true })

  const state: RunState = {
    runId,
    runDir,
    transcriptDir,
    statePath,
    reviewerSessionPath,
    fixerSessionPath,
    repoRoot: config.repoRoot,
    planPath,
    reviewerSessionId: null,
    fixerSessionId: null,
    currentRound: 0,
    noProgressRounds: 0,
  }

  await writeFile(reviewerSessionPath, JSON.stringify({ sessionId: null }, null, 2))
  await writeFile(fixerSessionPath, JSON.stringify({ sessionId: null }, null, 2))
  await saveRunState(state)
  return state
}

export async function loadRunState(workDir: string, runId: string): Promise<RunState> {
  const statePath = path.join(workDir, 'runs', runId, 'state.json')
  return RunStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
}

export async function saveRunState(state: RunState): Promise<void> {
  await writeFile(state.statePath, JSON.stringify(state, null, 2))
}
