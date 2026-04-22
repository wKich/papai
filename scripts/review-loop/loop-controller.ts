import pLimit from 'p-limit'

import { resolveInvocationText } from './available-commands.js'
import type { ChangeCapture } from './change-capture.js'
import type { ReviewLoopConfig } from './config.js'
import { computeIssueFingerprint } from './issue-fingerprint.js'
import {
  applyReviewRound,
  listAllFixChanges,
  markNeedsHumanForContradiction,
  recordFixAttempt,
  recordFixChange,
  recordVerification,
  saveHumanReview,
  saveIssueLedger,
  type FixChangeRecord,
  type IssueLedger,
  type LedgerIssueRecord,
} from './issue-ledger.js'
import {
  parseContradictionCheck,
  parseFixDescription,
  parseReviewerIssues,
  parseVerifierDecision,
} from './issue-schema.js'
import type { ContradictionCheck } from './issue-schema.js'
import {
  buildContradictionCheckPrompt,
  buildFixDescriptionPrompt,
  buildFixPrompt,
  buildRereviewPrompt,
  buildReviewPrompt,
  buildVerifyPrompt,
  type PriorFixChangeForPrompt,
} from './prompt-templates.js'
import { saveRunState, type RunState } from './run-state.js'

export interface PromptingSession {
  availableCommands: string[]
  promptText(text: string): Promise<{ text: string; stopReason: string }>
}

export interface ReviewLoopDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  reviewer: PromptingSession
  fixer: PromptingSession
  changeCapture: ChangeCapture
}

export interface ReviewLoopResult {
  doneReason: 'clean' | 'max_rounds' | 'no_progress'
  rounds: number
  ledger: IssueLedger['snapshot']
}

async function promptReviewerForIssues(
  promptBody: string,
  deps: ReviewLoopDeps,
): Promise<ReturnType<typeof parseReviewerIssues>> {
  const prompt = resolveInvocationText(
    deps.config.reviewer.invocationPrefix,
    deps.reviewer.availableCommands,
    promptBody,
    deps.config.reviewer.requireInvocationPrefix,
  )
  return parseReviewerIssues((await deps.reviewer.promptText(prompt)).text)
}

async function runContradictionCheck(
  record: LedgerIssueRecord,
  deps: ReviewLoopDeps,
): Promise<{ check: ContradictionCheck; priorChanges: PriorFixChangeForPrompt[] } | null> {
  const priorChanges = listAllFixChanges(deps.ledger)
  if (priorChanges.length === 0) {
    return null
  }
  const prompt = resolveInvocationText(
    deps.config.fixer.verifyInvocationPrefix,
    deps.fixer.availableCommands,
    buildContradictionCheckPrompt(record.issue, priorChanges),
    false,
  )
  const check = parseContradictionCheck((await deps.fixer.promptText(prompt)).text)
  return { check, priorChanges }
}

async function handleContradiction(
  record: LedgerIssueRecord,
  result: { check: ContradictionCheck; priorChanges: PriorFixChangeForPrompt[] },
  deps: ReviewLoopDeps,
): Promise<void> {
  const conflicting = result.check.conflictingChangeIndices
    .map((index) => result.priorChanges[index])
    .filter((entry): entry is PriorFixChangeForPrompt => entry !== undefined)

  markNeedsHumanForContradiction(deps.ledger, record.fingerprint, deps.runState.currentRound, result.check, conflicting)
  await saveHumanReview(deps.ledger)
  await saveIssueLedger(deps.ledger)
}

async function captureAndDescribeFix(
  record: LedgerIssueRecord,
  baseline: string,
  deps: ReviewLoopDeps,
): Promise<FixChangeRecord> {
  const delta = await deps.changeCapture.describeChangesSinceBaseline(baseline)
  const describePrompt = resolveInvocationText(
    deps.config.fixer.fixInvocationPrefix,
    deps.fixer.availableCommands,
    buildFixDescriptionPrompt(record.issue, delta.files, delta.diff),
    false,
  )
  const description = parseFixDescription((await deps.fixer.promptText(describePrompt)).text)
  return {
    round: deps.runState.currentRound,
    timestamp: new Date().toISOString(),
    files: delta.files,
    whatChanged: description.whatChanged,
    whyChanged: description.whyChanged,
  }
}

async function processIssueVerifyFix(
  record: LedgerIssueRecord,
  deps: ReviewLoopDeps,
): Promise<{ fixedThisIssue: boolean }> {
  const contradictionResult = await runContradictionCheck(record, deps)
  if (contradictionResult !== null && contradictionResult.check.contradicts) {
    await handleContradiction(record, contradictionResult, deps)
    return { fixedThisIssue: false }
  }

  const verifyPrompt = resolveInvocationText(
    deps.config.fixer.verifyInvocationPrefix,
    deps.fixer.availableCommands,
    buildVerifyPrompt(deps.runState.planPath, record.issue),
    deps.config.fixer.requireVerifyInvocation,
  )
  const verifyDecision = parseVerifierDecision((await deps.fixer.promptText(verifyPrompt)).text)
  recordVerification(deps.ledger, record.fingerprint, verifyDecision)

  if (verifyDecision.verdict === 'valid' && verifyDecision.fixability === 'auto') {
    const baseline = await deps.changeCapture.captureBaseline()
    const fixPrompt = resolveInvocationText(
      deps.config.fixer.fixInvocationPrefix,
      deps.fixer.availableCommands,
      buildFixPrompt(record.issue, verifyDecision),
      false,
    )
    await deps.fixer.promptText(fixPrompt)
    recordFixAttempt(deps.ledger, record.fingerprint)

    const fixChange = await captureAndDescribeFix(record, baseline, deps)
    recordFixChange(deps.ledger, record.fingerprint, fixChange)
    await saveIssueLedger(deps.ledger)
    return { fixedThisIssue: true }
  }
  return { fixedThisIssue: false }
}

async function rereviewRound(round: number, deps: ReviewLoopDeps): Promise<ReturnType<typeof parseReviewerIssues>> {
  const rereviewResponse = await promptReviewerForIssues(
    buildRereviewPrompt(deps.runState.planPath, Object.values(deps.ledger.snapshot.issues)),
    deps,
  )

  const unresolvedFingerprints = new Set(rereviewResponse.issues.map((issue) => computeIssueFingerprint(issue)))
  applyReviewRound(deps.ledger, round, rereviewResponse.issues)

  for (const record of Object.values(deps.ledger.snapshot.issues)) {
    if (record.status === 'fixed_pending_review' && !unresolvedFingerprints.has(record.fingerprint)) {
      record.status = 'closed'
    }
  }

  return rereviewResponse
}

const TERMINAL_STATUSES = new Set<LedgerIssueRecord['status']>(['rejected', 'already_fixed', 'needs_human'])

async function processReviewRecords(records: readonly LedgerIssueRecord[], deps: ReviewLoopDeps): Promise<number> {
  const limit = pLimit(1)
  const verifiable = records.filter((r) => !TERMINAL_STATUSES.has(r.status))
  const results = await Promise.all(verifiable.map((record) => limit(() => processIssueVerifyFix(record, deps))))
  return results.filter(({ fixedThisIssue }) => fixedThisIssue).length
}

async function runRound(round: number, noProgressRounds: number, deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  deps.runState.currentRound = round

  const reviewResponse = await promptReviewerForIssues(
    buildReviewPrompt(deps.runState.planPath, Object.values(deps.ledger.snapshot.issues)),
    deps,
  )
  const records = [...applyReviewRound(deps.ledger, round, reviewResponse.issues)]
  await saveIssueLedger(deps.ledger)

  if (records.length === 0) {
    await saveRunState(deps.runState)
    return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
  }

  const fixedThisRound = await processReviewRecords(records, deps)
  const rereviewResponse = await rereviewRound(round, deps)

  if (rereviewResponse.issues.length === 0) {
    await saveIssueLedger(deps.ledger)
    await saveRunState(deps.runState)
    return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
  }

  const newNoProgressRounds = fixedThisRound === 0 ? noProgressRounds + 1 : 0
  deps.runState.noProgressRounds = newNoProgressRounds
  await saveRunState(deps.runState)
  await saveIssueLedger(deps.ledger)

  if (newNoProgressRounds >= deps.config.maxNoProgressRounds) {
    return { doneReason: 'no_progress', rounds: round, ledger: deps.ledger.snapshot }
  }

  if (round >= deps.config.maxRounds) {
    return { doneReason: 'max_rounds', rounds: round, ledger: deps.ledger.snapshot }
  }

  return runRound(round + 1, newNoProgressRounds, deps)
}

export function runReviewLoop(deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  const nextRound = deps.runState.currentRound + 1
  if (nextRound > deps.config.maxRounds) {
    return Promise.resolve({
      doneReason: 'max_rounds',
      rounds: deps.runState.currentRound,
      ledger: deps.ledger.snapshot,
    })
  }
  return runRound(nextRound, deps.runState.noProgressRounds, deps)
}
