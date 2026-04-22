import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { reloadBehaviorAuditConfig } from '../../scripts/behavior-audit/config.js'
import type { BehaviorAuditTestConfig } from './behavior-audit-integration.helpers.js'

const tempDirs: string[] = []
const behaviorAuditEnvKeys = [
  'BEHAVIOR_AUDIT_MODEL',
  'BEHAVIOR_AUDIT_BASE_URL',
  'BEHAVIOR_AUDIT_PROJECT_ROOT',
  'BEHAVIOR_AUDIT_REPORTS_DIR',
  'BEHAVIOR_AUDIT_AUDIT_BEHAVIOR_DIR',
  'BEHAVIOR_AUDIT_BEHAVIORS_DIR',
  'BEHAVIOR_AUDIT_CLASSIFIED_DIR',
  'BEHAVIOR_AUDIT_CONSOLIDATED_DIR',
  'BEHAVIOR_AUDIT_STORIES_DIR',
  'BEHAVIOR_AUDIT_PROGRESS_PATH',
  'BEHAVIOR_AUDIT_INCREMENTAL_MANIFEST_PATH',
  'BEHAVIOR_AUDIT_CONSOLIDATED_MANIFEST_PATH',
  'BEHAVIOR_AUDIT_KEYWORD_VOCABULARY_PATH',
  'BEHAVIOR_AUDIT_PHASE1_TIMEOUT_MS',
  'BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS',
  'BEHAVIOR_AUDIT_PHASE3_TIMEOUT_MS',
  'BEHAVIOR_AUDIT_MAX_RETRIES',
  'BEHAVIOR_AUDIT_MAX_STEPS',
  'BEHAVIOR_AUDIT_EXCLUDED_PREFIXES',
] as const
const originalBehaviorAuditEnv = new Map(behaviorAuditEnvKeys.map((key) => [key, process.env[key]]))

function clearBehaviorAuditEnvKey(key: (typeof behaviorAuditEnvKeys)[number]): void {
  switch (key) {
    case 'BEHAVIOR_AUDIT_MODEL':
      delete process.env['BEHAVIOR_AUDIT_MODEL']
      return
    case 'BEHAVIOR_AUDIT_BASE_URL':
      delete process.env['BEHAVIOR_AUDIT_BASE_URL']
      return
    case 'BEHAVIOR_AUDIT_PROJECT_ROOT':
      delete process.env['BEHAVIOR_AUDIT_PROJECT_ROOT']
      return
    case 'BEHAVIOR_AUDIT_REPORTS_DIR':
      delete process.env['BEHAVIOR_AUDIT_REPORTS_DIR']
      return
    case 'BEHAVIOR_AUDIT_AUDIT_BEHAVIOR_DIR':
      delete process.env['BEHAVIOR_AUDIT_AUDIT_BEHAVIOR_DIR']
      return
    case 'BEHAVIOR_AUDIT_BEHAVIORS_DIR':
      delete process.env['BEHAVIOR_AUDIT_BEHAVIORS_DIR']
      return
    case 'BEHAVIOR_AUDIT_CLASSIFIED_DIR':
      delete process.env['BEHAVIOR_AUDIT_CLASSIFIED_DIR']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATED_DIR':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATED_DIR']
      return
    case 'BEHAVIOR_AUDIT_STORIES_DIR':
      delete process.env['BEHAVIOR_AUDIT_STORIES_DIR']
      return
    case 'BEHAVIOR_AUDIT_PROGRESS_PATH':
      delete process.env['BEHAVIOR_AUDIT_PROGRESS_PATH']
      return
    case 'BEHAVIOR_AUDIT_INCREMENTAL_MANIFEST_PATH':
      delete process.env['BEHAVIOR_AUDIT_INCREMENTAL_MANIFEST_PATH']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATED_MANIFEST_PATH':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATED_MANIFEST_PATH']
      return
    case 'BEHAVIOR_AUDIT_KEYWORD_VOCABULARY_PATH':
      delete process.env['BEHAVIOR_AUDIT_KEYWORD_VOCABULARY_PATH']
      return
    case 'BEHAVIOR_AUDIT_PHASE1_TIMEOUT_MS':
      delete process.env['BEHAVIOR_AUDIT_PHASE1_TIMEOUT_MS']
      return
    case 'BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS':
      delete process.env['BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS']
      return
    case 'BEHAVIOR_AUDIT_PHASE3_TIMEOUT_MS':
      delete process.env['BEHAVIOR_AUDIT_PHASE3_TIMEOUT_MS']
      return
    case 'BEHAVIOR_AUDIT_MAX_RETRIES':
      delete process.env['BEHAVIOR_AUDIT_MAX_RETRIES']
      return
    case 'BEHAVIOR_AUDIT_MAX_STEPS':
      delete process.env['BEHAVIOR_AUDIT_MAX_STEPS']
      return
    case 'BEHAVIOR_AUDIT_EXCLUDED_PREFIXES':
      delete process.env['BEHAVIOR_AUDIT_EXCLUDED_PREFIXES']
  }
}

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

export function applyBehaviorAuditEnv(config: BehaviorAuditTestConfig): void {
  process.env['BEHAVIOR_AUDIT_MODEL'] = config.MODEL
  process.env['BEHAVIOR_AUDIT_BASE_URL'] = config.BASE_URL
  process.env['BEHAVIOR_AUDIT_PROJECT_ROOT'] = config.PROJECT_ROOT
  process.env['BEHAVIOR_AUDIT_REPORTS_DIR'] = config.REPORTS_DIR
  process.env['BEHAVIOR_AUDIT_AUDIT_BEHAVIOR_DIR'] = config.AUDIT_BEHAVIOR_DIR
  process.env['BEHAVIOR_AUDIT_BEHAVIORS_DIR'] = config.BEHAVIORS_DIR
  process.env['BEHAVIOR_AUDIT_CLASSIFIED_DIR'] = config.CLASSIFIED_DIR
  process.env['BEHAVIOR_AUDIT_CONSOLIDATED_DIR'] = config.CONSOLIDATED_DIR
  process.env['BEHAVIOR_AUDIT_STORIES_DIR'] = config.STORIES_DIR
  process.env['BEHAVIOR_AUDIT_PROGRESS_PATH'] = config.PROGRESS_PATH
  process.env['BEHAVIOR_AUDIT_INCREMENTAL_MANIFEST_PATH'] = config.INCREMENTAL_MANIFEST_PATH
  process.env['BEHAVIOR_AUDIT_CONSOLIDATED_MANIFEST_PATH'] = config.CONSOLIDATED_MANIFEST_PATH
  process.env['BEHAVIOR_AUDIT_KEYWORD_VOCABULARY_PATH'] = config.KEYWORD_VOCABULARY_PATH
  process.env['BEHAVIOR_AUDIT_PHASE1_TIMEOUT_MS'] = String(config.PHASE1_TIMEOUT_MS)
  process.env['BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS'] = String(config.PHASE2_TIMEOUT_MS)
  process.env['BEHAVIOR_AUDIT_PHASE3_TIMEOUT_MS'] = String(config.PHASE3_TIMEOUT_MS)
  process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] = String(config.MAX_RETRIES)
  process.env['BEHAVIOR_AUDIT_MAX_STEPS'] = String(config.MAX_STEPS)
  process.env['BEHAVIOR_AUDIT_EXCLUDED_PREFIXES'] = config.EXCLUDED_PREFIXES.join('\n')
}

export function restoreBehaviorAuditEnv(): void {
  for (const key of behaviorAuditEnvKeys) {
    const originalValue = originalBehaviorAuditEnv.get(key)
    if (originalValue === undefined) {
      clearBehaviorAuditEnvKey(key)
      continue
    }
    process.env[key] = originalValue
  }

  reloadBehaviorAuditConfig()
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
