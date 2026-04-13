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

const UNSAFE_COMMAND_TOKENS = ['&&', '||', ';', '|', '>', '<', '`', '$(', '\n']

function isRepoPath(repoRoot: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(repoRoot)
  const resolvedCandidate = path.resolve(candidatePath)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
}

function isPathLikeToken(token: string): boolean {
  return token.startsWith('/') || token.startsWith('./') || token.startsWith('../') || token.includes('/')
}

function stripMatchingQuotes(token: string): string {
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1)
  }

  return token
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

function chooseOption(options: readonly PermissionOption[], kind: 'allow' | 'reject'): string {
  const preferredKinds =
    kind === 'allow' ? (['allow_once', 'allow_always'] as const) : (['reject_once', 'reject_always'] as const)

  const match = preferredKinds
    .map((preferredKind) => options.find((option) => option.kind === preferredKind))
    .find((option) => option !== undefined)

  if (match === undefined) {
    throw new Error(`No ${kind} option provided by the ACP agent`)
  }

  return match.optionId
}

function isSafeExecuteCommand(command: string): boolean {
  if (UNSAFE_COMMAND_TOKENS.some((token) => command.includes(token))) {
    return false
  }

  const normalizedCommand = normalizeCommand(command)
  return SAFE_EXECUTE_PATTERNS.some((pattern) => pattern.test(normalizedCommand))
}

function getPathCandidate(token: string): string | null {
  const normalizedToken = stripMatchingQuotes(token)

  if (normalizedToken.startsWith('-') && normalizedToken.includes('=')) {
    const value = normalizedToken.split(/=(.*)/, 2)[1] ?? ''
    const normalizedValue = stripMatchingQuotes(value)
    return isPathLikeToken(normalizedValue) ? normalizedValue : null
  }

  return isPathLikeToken(normalizedToken) ? normalizedToken : null
}

function areExecutePathsSafe(command: string, repoRoot: string): boolean {
  const tokens = normalizeCommand(command)
    .split(/\s+/)
    .filter((token) => token.length > 0)

  return tokens.every((token) => {
    const pathCandidate = getPathCandidate(token)
    if (pathCandidate === null) {
      return true
    }

    return isRepoPath(repoRoot, path.resolve(repoRoot, pathCandidate))
  })
}

export function decidePermissionOptionId(request: PermissionRequestLike, repoRoot: string): string {
  if (request.kind === 'edit' || request.kind === 'read' || request.kind === 'search') {
    const allPathsSafe =
      request.locations.length > 0 &&
      request.locations.every((location) => isRepoPath(repoRoot, path.resolve(repoRoot, location.path)))
    return chooseOption(request.options, allPathsSafe ? 'allow' : 'reject')
  }

  if (request.kind === 'execute') {
    const rawCommand = request.rawInput['command']
    const command = typeof rawCommand === 'string' ? rawCommand : ''
    const isSafe = isSafeExecuteCommand(command) && areExecutePathsSafe(command, repoRoot)
    return chooseOption(request.options, isSafe ? 'allow' : 'reject')
  }

  return chooseOption(request.options, 'reject')
}
