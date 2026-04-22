export interface FixChangeDelta {
  files: string[]
  diff: string
}

export interface ChangeCapture {
  captureBaseline(): Promise<string>
  describeChangesSinceBaseline(baseline: string): Promise<FixChangeDelta>
}

export const DEFAULT_MAX_DIFF_BYTES = 64 * 1024

export interface GitChangeCaptureOptions {
  maxDiffBytes: number
  env: Record<string, string | undefined> | null
}

async function runGit(
  cwd: string,
  args: readonly string[],
  env: Record<string, string | undefined> | null,
): Promise<string> {
  const spawnOptions =
    env === null
      ? { cwd, stdout: 'pipe' as const, stderr: 'pipe' as const }
      : { cwd, stdout: 'pipe' as const, stderr: 'pipe' as const, env }
  const proc = Bun.spawn(['git', ...args], spawnOptions)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim()}`)
  }
  return stdout
}

function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text
  }
  const sliced = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8')
  return `${sliced}\n...\n[truncated, full diff exceeded ${maxBytes} bytes]`
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function createGitChangeCapture(cwd: string, options: GitChangeCaptureOptions): ChangeCapture {
  const { maxDiffBytes, env } = options
  return {
    async captureBaseline() {
      const stashSha = (await runGit(cwd, ['stash', 'create'], env)).trim()
      if (stashSha.length > 0) {
        return stashSha
      }
      return (await runGit(cwd, ['rev-parse', 'HEAD'], env)).trim()
    },
    async describeChangesSinceBaseline(baseline) {
      const trackedChanged = splitLines(await runGit(cwd, ['diff', '--name-only', baseline], env))
      const untracked = splitLines(await runGit(cwd, ['ls-files', '--others', '--exclude-standard'], env))
      const files = Array.from(new Set([...trackedChanged, ...untracked])).toSorted()
      const diff = await runGit(cwd, ['diff', baseline], env)
      return { files, diff: truncate(diff, maxDiffBytes) }
    },
  }
}
