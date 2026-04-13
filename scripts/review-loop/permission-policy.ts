import path from 'node:path'

export interface PermissionOption {
  optionId: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export interface PermissionRequestLike {
  title: string
  kind: string
  locations: Array<{ path: string }>
  rawInput: Record<string, unknown>
  options: readonly PermissionOption[]
}

const SAFE_EXECUTE_PATTERNS = [
  /^git (status|diff|show)\b/,
  /^bun test\b/,
  /^bun run (typecheck|lint|format:check|check:full)\b/,
  /^oxfmt\b/,
  /^oxlint\b/,
]

function isRepoPath(repoRoot: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(repoRoot)
  const resolvedCandidate = path.resolve(candidatePath)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
}

function chooseOption(options: readonly PermissionOption[], kind: 'allow' | 'reject'): string {
  const match = options.find((option) =>
    kind === 'allow'
      ? option.kind === 'allow_once' || option.kind === 'allow_always'
      : option.kind === 'reject_once' || option.kind === 'reject_always',
  )

  if (match === undefined) {
    throw new Error(`No ${kind} option provided by the ACP agent`)
  }

  return match.optionId
}

export function decidePermissionOptionId(request: PermissionRequestLike, repoRoot: string): string {
  if (request.kind === 'edit' || request.kind === 'read' || request.kind === 'search') {
    const allPathsSafe = request.locations.every((location) => isRepoPath(repoRoot, location.path))
    return chooseOption(request.options, allPathsSafe ? 'allow' : 'reject')
  }

  if (request.kind === 'execute') {
    const rawCommand = request.rawInput['command']
    const command = typeof rawCommand === 'string' ? rawCommand : ''
    const isSafe = SAFE_EXECUTE_PATTERNS.some((pattern) => pattern.test(command))
    return chooseOption(request.options, isSafe ? 'allow' : 'reject')
  }

  return chooseOption(request.options, 'reject')
}
