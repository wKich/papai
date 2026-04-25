/**
 * plan-adr-workflow.ts
 *
 * Walks through docs/superpowers/plans/, checks each plan's implementation
 * status via opencode, writes ADR documents for fully-implemented plans
 * using the /adr skill, and archives both the plan and its spec file.
 *
 * Prerequisites:
 *   - opencode installed and in PATH
 *   - /adr skill configured in .opencode/commands/adr.md
 *
 * Usage:
 *   bun scripts/plan-adr-workflow.ts
 *   bun scripts/plan-adr-workflow.ts --dry-run
 *   bun scripts/plan-adr-workflow.ts --filter deferred
 *   bun scripts/plan-adr-workflow.ts --port 4097
 */

import { access, constants as fsConstants, readFile, readdir, rename } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { createOpencode } from '@opencode-ai/sdk/v2'

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanStatus = 'fully_implemented' | 'partially_implemented' | 'not_implemented' | 'unclear'

type WorkflowResult =
  | { readonly kind: 'adr_written'; readonly planFile: string; readonly specFile: string | null }
  | {
      readonly kind: 'skipped'
      readonly planFile: string
      readonly status: PlanStatus
      readonly reason: string
    }
  | { readonly kind: 'error'; readonly planFile: string; readonly error: string }

interface CliArgs {
  readonly dryRun: boolean
  readonly filter: string | null
  readonly port: number
}

interface ImplementationCheck {
  readonly status: PlanStatus
  readonly is_fully_implemented: boolean
  readonly evidence: string
  readonly spec_path?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(join(import.meta.dirname, '..'))
const PLANS_DIR = join(PROJECT_ROOT, 'docs/superpowers/plans')
const SPECS_DIR = join(PROJECT_ROOT, 'docs/superpowers/specs')
const ARCHIVE_DIR = join(PROJECT_ROOT, 'docs/archive')

const IMPLEMENTATION_CHECK_SCHEMA = {
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

// ─── CLI Parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2)

  const dryRun = args.includes('--dry-run')

  const filterIdx = args.indexOf('--filter')
  const filter = filterIdx >= 0 ? (args[filterIdx + 1] ?? null) : null

  const portIdx = args.indexOf('--port')
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1] ?? '4097', 10) : 4097

  return { dryRun, filter, port }
}

// ─── Plan Discovery ───────────────────────────────────────────────────────────

async function discoverPlanFiles(filter: string | null): Promise<readonly string[]> {
  const files = await readdir(PLANS_DIR)
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

function extractSpecReference(content: string): string | null {
  for (const pattern of SPEC_PATTERNS) {
    const match = pattern.exec(content)
    if (match?.[1]) return match[1]
  }
  return null
}

// ─── File Utilities ───────────────────────────────────────────────────────────

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function resolveSpecFile(
  specPathFromLlm: string | undefined,
  specPathFromContent: string | null,
): Promise<string | null> {
  const candidates = [specPathFromLlm, specPathFromContent].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )

  for (const candidate of candidates) {
    const absolute = candidate.startsWith('docs/')
      ? join(PROJECT_ROOT, candidate)
      : join(SPECS_DIR, basename(candidate))
    if (await fileExists(absolute)) return absolute
  }
  return null
}

async function archiveFile(absolutePath: string, dryRun: boolean): Promise<void> {
  const dest = join(ARCHIVE_DIR, basename(absolutePath))
  if (dryRun) {
    console.log(`    [dry-run] would move: ${basename(absolutePath)} -> docs/archive/`)
    return
  }
  await rename(absolutePath, dest)
  console.log(`    archived: ${basename(absolutePath)}`)
}

// ─── Session Management ───────────────────────────────────────────────────────

type OpencodeClient = Awaited<ReturnType<typeof createOpencode>>['client']

async function createSession(client: OpencodeClient, title: string): Promise<string> {
  const result = await client.session.create({ title })
  const sessionID = result.data?.id
  if (!sessionID) throw new Error('session.create returned no id')
  return sessionID
}

async function deleteSession(client: OpencodeClient, sessionID: string): Promise<void> {
  try {
    await client.session.delete({ sessionID })
  } catch {
    // best-effort session cleanup — non-fatal
  }
}

// ─── Implementation Check ─────────────────────────────────────────────────────

async function checkImplementationStatus(
  client: OpencodeClient,
  sessionID: string,
  planFile: string,
): Promise<ImplementationCheck> {
  const planRelPath = `docs/superpowers/plans/${planFile}`
  const result = await client.session.prompt({
    sessionID,
    parts: [
      {
        type: 'text',
        text: [
          `Read the implementation plan at @${planRelPath} and verify its status in the codebase.`,
          '',
          'Steps:',
          '1. Read the plan to understand the goal, target files, and task checklist',
          '2. Check whether the key source files listed in the plan exist with the expected content',
          '3. If the plan has checkbox tasks (- [x] done / - [ ] todo), note the completion ratio',
          '4. Look for a "Spec:" or "Design:" reference in the plan frontmatter or body',
          '5. Return structured JSON with your findings',
        ].join('\n'),
      },
    ],
    format: {
      type: 'json_schema',
      schema: IMPLEMENTATION_CHECK_SCHEMA,
    },
  })

  const structured = result.data?.info?.structured as ImplementationCheck | undefined
  if (!structured) throw new Error('implementation check returned no structured output')
  return structured
}

// ─── ADR Command ─────────────────────────────────────────────────────────────

async function runAdrCommand(client: OpencodeClient, sessionID: string): Promise<void> {
  // /adr is a custom skill command configured in .opencode/commands/adr.md
  await client.session.command({
    sessionID,
    command: 'adr',
    arguments: '',
  })
}

// ─── Per-Plan Processing ──────────────────────────────────────────────────────

async function processPlan(
  client: OpencodeClient,
  planFile: string,
  planContent: string,
  dryRun: boolean,
): Promise<WorkflowResult> {
  const specRefFromContent = extractSpecReference(planContent)
  let sessionID: string | null = null

  try {
    sessionID = await createSession(client, `adr-workflow: ${planFile}`)

    const check = await checkImplementationStatus(client, sessionID, planFile)
    console.log(`  status:   ${check.status}`)
    const evidencePreview = check.evidence.length > 120 ? `${check.evidence.slice(0, 120)}...` : check.evidence
    console.log(`  evidence: ${evidencePreview}`)

    if (!check.is_fully_implemented) {
      return { kind: 'skipped', planFile, status: check.status, reason: check.evidence }
    }

    if (!dryRun) {
      await runAdrCommand(client, sessionID)
      console.log('  /adr command completed')
    } else {
      console.log('  [dry-run] would run /adr command')
    }

    const specPath = await resolveSpecFile(check.spec_path, specRefFromContent)

    await archiveFile(join(PLANS_DIR, planFile), dryRun)

    if (specPath) {
      await archiveFile(specPath, dryRun)
    }

    return { kind: 'adr_written', planFile, specFile: specPath ? basename(specPath) : null }
  } catch (error) {
    return {
      kind: 'error',
      planFile,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (sessionID) {
      await deleteSession(client, sessionID)
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function printSummary(results: readonly WorkflowResult[]): void {
  const written = results.filter((r) => r.kind === 'adr_written')
  const skipped = results.filter((r) => r.kind === 'skipped')
  const errors = results.filter((r) => r.kind === 'error')

  console.log('\n' + '-'.repeat(60))
  console.log(`Plans processed: ${results.length}`)
  console.log(`  ADRs written : ${written.length}`)
  console.log(`  Skipped      : ${skipped.length}  (not fully implemented)`)
  console.log(`  Errors       : ${errors.length}`)

  if (errors.length > 0) {
    console.log('\nErrors:')
    for (const r of errors) {
      if (r.kind === 'error') console.log(`  ${r.planFile}: ${r.error}`)
    }
  }

  if (written.length > 0) {
    console.log('\nADRs written:')
    for (const r of written) {
      if (r.kind === 'adr_written') {
        const specNote = r.specFile ? ` (+ spec: ${r.specFile})` : ''
        console.log(`  ${r.planFile}${specNote}`)
      }
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (args.dryRun) {
    console.log('-- DRY RUN -- no files moved, no ADRs written\n')
  }

  const planFiles = await discoverPlanFiles(args.filter)
  if (planFiles.length === 0) {
    console.log('No plan files found matching the filter.')
    return
  }

  console.log(`Found ${planFiles.length} plan(s). Starting opencode server...\n`)

  let opencode: Awaited<ReturnType<typeof createOpencode>> | null = null

  try {
    opencode = await createOpencode({ port: args.port })
    const { client } = opencode

    // Verify connectivity
    await client.global.health()

    const results: WorkflowResult[] = []

    for (const [index, planFile] of planFiles.entries()) {
      console.log(`\n[${index + 1}/${planFiles.length}] ${planFile}`)

      const planContent = await readFile(join(PLANS_DIR, planFile), 'utf-8')
      const result = await processPlan(client, planFile, planContent, args.dryRun)

      results.push(result)

      if (result.kind === 'adr_written') {
        const specNote = result.specFile ? ` + spec archived` : ''
        console.log(`  ADR written, plan archived${specNote}`)
      } else if (result.kind === 'skipped') {
        console.log(`  -> skipped (${result.status})`)
      } else {
        console.log(`  error: ${result.error}`)
      }
    }

    printSummary(results)
  } finally {
    opencode?.server.close()
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error('Fatal:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
