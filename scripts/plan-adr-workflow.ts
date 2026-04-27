/**
 * plan-adr-workflow.ts
 *
 * Walks through docs/superpowers/plans/, checks each plan's implementation
 * status via opencode, writes ADR documents for fully-implemented plans
 * using the architecture-decision-records skill, and archives both the plan
 * and its spec file.
 *
 * Prerequisites:
 *   - opencode installed and in PATH
 *   - architecture-decision-records skill in .agents/skills/
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
  const sessionData = result.data
  const sessionID = sessionData === undefined ? undefined : sessionData.id
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
    'status' in value &&
    typeof value.status === 'string' &&
    'is_fully_implemented' in value &&
    typeof value.is_fully_implemented === 'boolean' &&
    'evidence' in value &&
    typeof value.evidence === 'string'
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

  const responseData = result.data
  if (responseData === undefined) throw new Error('session.prompt returned no data')
  const responseInfo = responseData.info
  const structured: unknown = responseInfo === undefined ? undefined : responseInfo.structured
  if (!isImplementationCheck(structured)) throw new Error('implementation check returned no structured output')
  return structured
}

// ─── ADR Command ─────────────────────────────────────────────────────────────

async function runAdrCommand(client: OpencodeClient, sessionID: string, planFile: string): Promise<void> {
  await client.session.prompt({
    sessionID,
    parts: [
      {
        type: 'text',
        text: [
          `Use the architecture-decision-records skill to write an ADR for the decision implemented in @docs/superpowers/plans/${planFile}.`,
          '',
          'Steps:',
          '1. Load the architecture-decision-records skill',
          '2. List existing files in docs/adr/ to determine the next sequential ADR number',
          '3. Write the ADR using the MADR template from the skill with status "Accepted"',
          '4. Save it to docs/adr/<NNNN>-<kebab-case-title>.md',
          '5. The ADR must document the architectural decision: what was chosen, why, and the consequences',
        ].join('\n'),
      },
    ],
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
      console.log('  [dry-run] would run architecture-decision-records skill')
    } else {
      await runAdrCommand(client, sessionID, planFile)
      console.log('  ADR skill completed')
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
    if (opencode !== null) opencode.server.close()
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error('Fatal:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
