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

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { createOpencode } from '@opencode-ai/sdk/v2'

import {
  IMPLEMENTATION_CHECK_SCHEMA,
  PLANS_DIR,
  SPECS_DIR,
  PROJECT_ROOT,
  type ImplementationCheck,
  type WorkflowResult,
  archiveFile,
  discoverPlanFiles,
  extractSpecReference,
  parseArgs,
  resolveSpecFile,
} from './plan-adr-workflow-helpers.js'

// ─── Session Management ───────────────────────────────────────────────────────

type OpencodeClient = Awaited<ReturnType<typeof createOpencode>>['client']

async function createSession(client: OpencodeClient, title: string): Promise<string> {
  const result = await client.session.create({ title })
  const sessionID = result.data?.id
  if (sessionID === undefined || sessionID === '') throw new Error('session.create returned no id')
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

function isImplementationCheck(value: unknown): value is ImplementationCheck {
  if (typeof value !== 'object' || value === null) return false
  return (
    typeof (value as { status?: unknown })['status'] === 'string' &&
    typeof (value as { is_fully_implemented?: unknown })['is_fully_implemented'] === 'boolean' &&
    typeof (value as { evidence?: unknown })['evidence'] === 'string'
  )
}

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

  const structured: unknown = result.data?.info?.structured
  if (!isImplementationCheck(structured)) throw new Error('implementation check returned no structured output')
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

    if (dryRun) {
      console.log('  [dry-run] would run /adr command')
    } else {
      await runAdrCommand(client, sessionID)
      console.log('  /adr command completed')
    }

    const specPath = await resolveSpecFile(check.spec_path, specRefFromContent, SPECS_DIR, PROJECT_ROOT)

    await archiveFile(join(PLANS_DIR, planFile), dryRun)

    if (specPath !== null) {
      await archiveFile(specPath, dryRun)
    }

    return { kind: 'adr_written', planFile, specFile: specPath === null ? null : basename(specPath) }
  } catch (error) {
    return {
      kind: 'error',
      planFile,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (sessionID !== null) {
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
        const specNote = r.specFile === null ? '' : ` (+ spec: ${r.specFile})`
        console.log(`  ${r.planFile}${specNote}`)
      }
    }
  }
}

// ─── Plan Execution Loop ──────────────────────────────────────────────────────

// Plans must run sequentially: each uses a fresh opencode session and may
// archive files that affect subsequent plan discovery. Using reduce avoids
// awaiting inside a for-loop while preserving order.
function runPlanSequence(
  client: OpencodeClient,
  planFiles: readonly string[],
  dryRun: boolean,
): Promise<readonly WorkflowResult[]> {
  return planFiles.reduce<Promise<WorkflowResult[]>>(async (accPromise, planFile, index) => {
    const acc = await accPromise
    console.log(`\n[${index + 1}/${planFiles.length}] ${planFile}`)
    const planContent = await readFile(join(PLANS_DIR, planFile), 'utf-8')
    const result = await processPlan(client, planFile, planContent, dryRun)
    acc.push(result)

    if (result.kind === 'adr_written') {
      const specNote = result.specFile === null ? '' : ` + spec archived`
      console.log(`  ADR written, plan archived${specNote}`)
    } else if (result.kind === 'skipped') {
      console.log(`  -> skipped (${result.status})`)
    } else {
      console.log(`  error: ${result.error}`)
    }

    return acc
  }, Promise.resolve([]))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (args.dryRun) {
    console.log('-- DRY RUN -- no files moved, no ADRs written\n')
  }

  const planFiles = await discoverPlanFiles(args.filter, PLANS_DIR)
  if (planFiles.length === 0) {
    console.log('No plan files found matching the filter.')
    return
  }

  console.log(`Found ${planFiles.length} plan(s). Starting opencode server...\n`)

  let opencode: Awaited<ReturnType<typeof createOpencode>> | null = null

  try {
    opencode = await createOpencode({ port: args.port })
    const { client } = opencode
    await client.global.health()
    const results = await runPlanSequence(client, planFiles, args.dryRun)
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
