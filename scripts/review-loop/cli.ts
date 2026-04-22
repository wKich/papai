import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createAcpProcessClient, type AcpProcessClient } from './acp-process-client.js'
import { bootstrapAgentSession, type BootstrappedAgentSession } from './agent-session.js'
import { loadReviewLoopConfig, type ReviewLoopConfig } from './config.js'
import { createIssueLedger, loadIssueLedger, type IssueLedger } from './issue-ledger.js'
import { runReviewLoop } from './loop-controller.js'
import { decidePermissionOptionId } from './permission-policy.js'
import type { ProgressLog } from './progress-log.js'
import { createRunState, loadRunState, saveRunState, type RunState } from './run-state.js'
import { formatSummary } from './summary.js'

export interface CliArgs {
  configPath: string
  planPath: string
  repoRoot?: string
  resumeRunId?: string
}

type ClosableClient = Pick<AcpProcessClient, 'close'>

function isRejectedCloseResult(result: PromiseSettledResult<unknown>): result is PromiseRejectedResult {
  return result.status === 'rejected'
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let configPath = '.review-loop/config.json'
  let planPath: string | undefined
  let repoRoot: string | undefined
  let resumeRunId: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config') {
      const value = argv[index + 1]
      if (value === undefined) {
        throw new Error('Missing value for --config')
      }
      configPath = value
      index += 1
      continue
    }
    if (arg === '--plan') {
      planPath = argv[index + 1]
      if (planPath === undefined) {
        throw new Error('Missing value for --plan')
      }
      index += 1
      continue
    }
    if (arg === '--repo') {
      repoRoot = argv[index + 1]
      if (repoRoot === undefined) {
        throw new Error('Missing value for --repo')
      }
      index += 1
      continue
    }
    if (arg === '--resume-run') {
      resumeRunId = argv[index + 1]
      if (resumeRunId === undefined) {
        throw new Error('Missing value for --resume-run')
      }
      index += 1
    }
  }

  if (planPath === undefined) {
    throw new Error('Missing required --plan')
  }

  return { configPath, planPath, repoRoot, resumeRunId }
}

async function bootstrapClients(
  config: ReviewLoopConfig,
  runState: RunState,
): Promise<{ reviewerClient: AcpProcessClient; fixerClient: AcpProcessClient }> {
  const reviewerClient = await createAcpProcessClient({
    command: config.reviewer.command,
    args: config.reviewer.args,
    cwd: config.repoRoot,
    env: { ...process.env, ...config.reviewer.env },
    transcriptPath: path.join(runState.transcriptDir, 'reviewer.ndjson'),
    selectPermissionOptionId: (request) => decidePermissionOptionId(request, config.repoRoot),
  })
  try {
    const fixerClient = await createAcpProcessClient({
      command: config.fixer.command,
      args: config.fixer.args,
      cwd: config.repoRoot,
      env: { ...process.env, ...config.fixer.env },
      transcriptPath: path.join(runState.transcriptDir, 'fixer.ndjson'),
      selectPermissionOptionId: (request) => decidePermissionOptionId(request, config.repoRoot),
    })
    return { reviewerClient, fixerClient }
  } catch (error) {
    await reviewerClient.close()
    throw error
  }
}

async function bootstrapSessions(
  config: ReviewLoopConfig,
  runState: RunState,
  reviewerClient: AcpProcessClient,
  fixerClient: AcpProcessClient,
): Promise<{ reviewerSession: BootstrappedAgentSession; fixerSession: BootstrappedAgentSession }> {
  const reviewerSession = await bootstrapAgentSession(reviewerClient, {
    cwd: config.repoRoot,
    previousSessionId: runState.reviewerSessionId,
    sessionConfig: config.reviewer.sessionConfig,
  })
  const fixerSession = await bootstrapAgentSession(fixerClient, {
    cwd: config.repoRoot,
    previousSessionId: runState.fixerSessionId,
    sessionConfig: config.fixer.sessionConfig,
  })
  return { reviewerSession, fixerSession }
}

async function persistSessionIds(
  runState: RunState,
  reviewerSession: BootstrappedAgentSession,
  fixerSession: BootstrappedAgentSession,
): Promise<void> {
  runState.reviewerSessionId = reviewerSession.sessionId
  runState.fixerSessionId = fixerSession.sessionId
  await writeFile(runState.reviewerSessionPath, JSON.stringify({ sessionId: reviewerSession.sessionId }, null, 2))
  await writeFile(runState.fixerSessionPath, JSON.stringify({ sessionId: fixerSession.sessionId }, null, 2))
  await saveRunState(runState)
}

export async function closeClients(
  reviewerClient: ClosableClient | null,
  fixerClient: ClosableClient | null,
): Promise<void> {
  const closeResults = await Promise.allSettled([reviewerClient?.close(), fixerClient?.close()])
  const rejections = closeResults.filter(isRejectedCloseResult)
  if (rejections.length === 1) {
    const [rejection] = rejections
    if (rejection !== undefined) {
      throw rejection.reason
    }
  }
  if (rejections.length > 1) {
    throw new AggregateError(
      rejections.map((result): unknown => result.reason),
      'Failed to close ACP clients',
    )
  }
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const args = parseCliArgs(argv)
  const config = await loadReviewLoopConfig({
    configPath: args.configPath,
    repoRoot: args.repoRoot,
  })

  const runState: RunState =
    args.resumeRunId === undefined
      ? await createRunState(config, args.planPath)
      : await loadRunState(config.workDir, args.resumeRunId)

  const ledger: IssueLedger =
    args.resumeRunId === undefined ? await createIssueLedger(runState.runDir) : await loadIssueLedger(runState.runDir)

  let reviewerClient: AcpProcessClient | null = null
  let fixerClient: AcpProcessClient | null = null

  try {
    const clients = await bootstrapClients(config, runState)
    reviewerClient = clients.reviewerClient
    fixerClient = clients.fixerClient

    const { reviewerSession, fixerSession } = await bootstrapSessions(config, runState, reviewerClient, fixerClient)

    await persistSessionIds(runState, reviewerSession, fixerSession)

    const log: ProgressLog = { log: console.log }

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: reviewerSession,
      fixer: fixerSession,
      log,
    })

    const summary = formatSummary(result)
    await writeFile(path.join(runState.runDir, 'summary.txt'), `${summary}\n`)
    console.log(summary)
  } finally {
    await closeClients(reviewerClient, fixerClient)
  }
}
