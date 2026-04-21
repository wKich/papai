import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const tempDirs: string[] = []

export const originalProcessExit = process.exit.bind(process)
export const originalOpenAiApiKey = process.env['OPENAI_API_KEY']

export function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'behavior-audit-integration-'))
  tempDirs.push(dir)
  return dir
}

export async function runCommand(command: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const errorMessage = stderr.trim()
    throw new Error(errorMessage.length > 0 ? errorMessage : `Command failed: ${command.join(' ')}`)
  }
  return stdout.trim()
}

export async function initializeGitRepo(root: string): Promise<void> {
  await runCommand(['git', 'init', '-q'], root)
  await runCommand(
    [
      'git',
      '-c',
      'user.name=Test User',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'init',
      '-q',
    ],
    root,
  )
}

export async function commitAll(root: string, message: string): Promise<void> {
  await runCommand(['git', 'add', '.'], root)
  await runCommand(
    [
      'git',
      '-c',
      'user.name=Test User',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      message,
      '-q',
    ],
    root,
  )
}

export function restoreOpenAiApiKey(): void {
  if (originalOpenAiApiKey === undefined) {
    delete process.env['OPENAI_API_KEY']
    return
  }
  process.env['OPENAI_API_KEY'] = originalOpenAiApiKey
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function resolveExitCode(code: number | undefined): number {
  if (code === undefined) {
    return 0
  }
  return code
}
