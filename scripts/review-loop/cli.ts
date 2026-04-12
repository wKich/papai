import type { ReviewLoopConfig } from './config.js'
import { loadReviewLoopConfig } from './config.js'

export interface CliArgs {
  configPath: string
  planPath: string
  repoRoot?: string
  resumeRunId?: string
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

export async function runCli(argv: readonly string[]): Promise<ReviewLoopConfig> {
  const args = parseCliArgs(argv)
  const config = await loadReviewLoopConfig({
    configPath: args.configPath,
    repoRoot: args.repoRoot,
    planPath: args.planPath,
  })
  console.log(`Loaded ACP review loop config for ${config.repoRoot}`)
  return config
}
