/**
 * plan-adr-workflow-helpers.ts
 *
 * Shared types, constants, and utility functions for plan-adr-workflow.ts.
 */

import { access, constants as fsConstants, mkdir, rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanStatus = 'fully_implemented' | 'partially_implemented' | 'not_implemented' | 'unclear'

export type WorkflowResult =
  | { readonly kind: 'adr_written'; readonly planFile: string; readonly specFile: string | null }
  | {
      readonly kind: 'skipped'
      readonly planFile: string
      readonly status: PlanStatus
      readonly reason: string
      readonly remainingDocFile: string | null
    }
  | { readonly kind: 'error'; readonly planFile: string; readonly error: string }

export interface CliArgs {
  readonly dryRun: boolean
  readonly filter: string | null
  readonly port: number
  readonly model: string
}

export interface ImplementationCheck {
  readonly status: PlanStatus
  readonly is_fully_implemented: boolean
  readonly evidence: string
  readonly spec_path: string | undefined
}

export interface RemainingWork {
  readonly completed_items: readonly string[]
  readonly remaining_items: readonly string[]
  readonly suggested_next_steps: readonly string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PROJECT_ROOT = resolve(join(import.meta.dirname, '..'))
export const PLANS_DIR = join(PROJECT_ROOT, 'docs/superpowers/plans')
export const SPECS_DIR = join(PROJECT_ROOT, 'docs/superpowers/specs')
export const REMAINING_DIR = join(PROJECT_ROOT, 'docs/superpowers/remaining')
export const ARCHIVE_DIR = join(PROJECT_ROOT, 'docs/archive')

export const IMPLEMENTATION_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['fully_implemented', 'partially_implemented', 'not_implemented', 'unclear'],
      description: 'Overall implementation status of the plan',
    },
    is_fully_implemented: {
      type: 'boolean',
      description:
        'True only when ALL key features, tasks, and file changes described in the plan exist in the codebase',
    },
    evidence: {
      type: 'string',
      description:
        'Concise evidence: list which key files are present or absent, mention checkbox completion ratio if applicable',
    },
    spec_path: {
      type: 'string',
      description:
        'Relative path to the design/spec document explicitly referenced in the plan (e.g. docs/superpowers/specs/...). Empty string if none found.',
    },
  },
  required: ['status', 'is_fully_implemented', 'evidence'],
} as const

export const REMAINING_WORK_SCHEMA = {
  type: 'object',
  properties: {
    completed_items: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concise list of plan tasks or features that are already fully implemented in the codebase',
    },
    remaining_items: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concise list of plan tasks or features that are not yet implemented or are incomplete',
    },
    suggested_next_steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Prioritised list of actionable next steps to fully implement the plan',
    },
  },
  required: ['completed_items', 'remaining_items', 'suggested_next_steps'],
} as const

// ─── CLI Parsing ──────────────────────────────────────────────────────────────

export function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2)

  const dryRun = args.includes('--dry-run')

  const filterIdx = args.indexOf('--filter')
  let filter: string | null = null
  if (filterIdx >= 0) {
    const arg = args[filterIdx + 1]
    if (arg !== undefined) filter = arg
  }

  const portIdx = args.indexOf('--port')
  let port = 4097
  if (portIdx >= 0) {
    const portArg = args[portIdx + 1]
    port = portArg === undefined ? 4097 : parseInt(portArg, 10)
  }

  const modelIdx = args.indexOf('--model')
  const model = modelIdx >= 0 && args[modelIdx + 1] !== undefined ? args[modelIdx + 1]! : 'localhost/Gemma-4-26B-A4B'

  return { dryRun, filter, port, model }
}

// ─── Plan Discovery ───────────────────────────────────────────────────────────

export async function discoverPlanFiles(filter: string | null, plansDir: string): Promise<readonly string[]> {
  const { readdir } = await import('node:fs/promises')
  const files = await readdir(plansDir)
  const mdFiles = files.filter((f) => f.endsWith('.md')).toSorted()
  return filter === null ? mdFiles : mdFiles.filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
}

// ─── Spec Reference Extraction ────────────────────────────────────────────────

const SPEC_PATTERNS: readonly RegExp[] = [
  /\*\*Spec:\*\*\s*`([^`]+docs\/superpowers\/specs\/[^`]+)`/i,
  /\*\*Spec(?:ification)?:\*\*\s*`([^`]+)`/i,
  /\*\*Design(?:\s+Doc)?:\*\*\s*`([^`]+)`/i,
  /^Spec:\s*`([^`]+)`/im,
]

export function extractSpecReference(content: string): string | null {
  for (const pattern of SPEC_PATTERNS) {
    const match = pattern.exec(content)
    if (match !== null && match[1] !== undefined && match[1] !== '') return match[1]
  }
  return null
}

// ─── File Utilities ───────────────────────────────────────────────────────────

export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function resolveSpecFile(
  specPathFromLlm: string | undefined,
  specPathFromContent: string | null,
  specsDir: string,
  projectRoot: string,
): Promise<string | null> {
  const candidates = [specPathFromLlm, specPathFromContent].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )

  const absolutePaths = candidates.map((candidate) =>
    candidate.startsWith('docs/') ? join(projectRoot, candidate) : join(specsDir, basename(candidate)),
  )

  const existsResults = await Promise.all(absolutePaths.map((p) => fileExists(p)))

  for (const [i, exists] of existsResults.entries()) {
    const path = absolutePaths[i]
    if (exists && path !== undefined) return path
  }
  return null
}

export async function archiveFile(absolutePath: string, dryRun: boolean): Promise<void> {
  const dest = join(ARCHIVE_DIR, basename(absolutePath))
  if (dryRun) {
    console.log(`    [dry-run] would move: ${basename(absolutePath)} -> docs/archive/`)
    return
  }
  await rename(absolutePath, dest)
  console.log(`    archived: ${basename(absolutePath)}`)
}

function buildRemainingWorkContent(planFile: string, status: PlanStatus, work: RemainingWork): string {
  const title = planFile.replace(/\.md$/, '').replace(/-/g, ' ')
  const date = new Date().toISOString().slice(0, 10)

  const completedSection =
    work.completed_items.length === 0
      ? '_None identified._'
      : work.completed_items.map((item) => `- ${item}`).join('\n')

  const remainingSection =
    work.remaining_items.length === 0
      ? '_None identified._'
      : work.remaining_items.map((item) => `- ${item}`).join('\n')

  const nextStepsSection =
    work.suggested_next_steps.length === 0
      ? '_No suggestions available._'
      : work.suggested_next_steps.map((step, i) => `${i + 1}. ${step}`).join('\n')

  return [
    `# Remaining Work: ${title}`,
    '',
    `**Status:** ${status}`,
    `**Generated:** ${date}`,
    `**Plan:** \`docs/superpowers/plans/${planFile}\``,
    '',
    '## Completed',
    '',
    completedSection,
    '',
    '## Remaining',
    '',
    remainingSection,
    '',
    '## Suggested Next Steps',
    '',
    nextStepsSection,
    '',
  ].join('\n')
}

export async function writeRemainingWorkDoc(
  planFile: string,
  status: PlanStatus,
  work: RemainingWork,
  dryRun: boolean,
): Promise<string> {
  const destPath = join(REMAINING_DIR, planFile)
  const content = buildRemainingWorkContent(planFile, status, work)

  if (dryRun) {
    console.log(`    [dry-run] would write: docs/superpowers/remaining/${planFile}`)
    return destPath
  }

  await mkdir(REMAINING_DIR, { recursive: true })
  await writeFile(destPath, content, 'utf-8')
  console.log(`    remaining-work doc written: docs/superpowers/remaining/${planFile}`)
  return destPath
}
