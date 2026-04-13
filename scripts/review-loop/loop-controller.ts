import { resolveInvocationText } from './available-commands.js'
import type { ReviewLoopConfig } from './config.js'
import { computeIssueFingerprint } from './issue-fingerprint.js'
import {
  applyReviewRound,
  recordFixAttempt,
  recordVerification,
  saveIssueLedger,
  type IssueLedger,
  type LedgerIssueRecord,
} from './issue-ledger.js'
import { parseReviewerIssues, parseVerifierDecision } from './issue-schema.js'
import { buildFixPrompt, buildReviewPrompt, buildRereviewPrompt, buildVerifyPrompt } from './prompt-templates.js'
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
}

export interface ReviewLoopResult {
  doneReason: 'clean' | 'max_rounds' | 'no_progress'
  rounds: number
  ledger: IssueLedger['snapshot']
}

async function processIssueVerifyFix(
  record: LedgerIssueRecord,
  deps: ReviewLoopDeps,
): Promise<{ fixedThisIssue: boolean }> {
  const verifyPrompt = resolveInvocationText(
    deps.config.fixer.verifyInvocationPrefix,
    deps.fixer.availableCommands,
    buildVerifyPrompt(deps.runState.planPath, record.issue),
    deps.config.fixer.requireVerifyInvocation,
  )
  const verifyDecision = parseVerifierDecision((await deps.fixer.promptText(verifyPrompt)).text)
  recordVerification(deps.ledger, record.fingerprint, verifyDecision)

  if (verifyDecision.verdict === 'valid' && verifyDecision.fixability === 'auto') {
    await deps.fixer.promptText(buildFixPrompt(record.issue, verifyDecision))
    recordFixAttempt(deps.ledger, record.fingerprint)
    return { fixedThisIssue: true }
  }
  return { fixedThisIssue: false }
}

export async function runReviewLoop(deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  let noProgressRounds = deps.runState.noProgressRounds

  while (deps.runState.currentRound < deps.config.maxRounds) {
    deps.runState.currentRound += 1
    const round = deps.runState.currentRound

    const reviewPrompt = resolveInvocationText(
      deps.config.reviewer.invocationPrefix,
      deps.reviewer.availableCommands,
      buildReviewPrompt(deps.runState.planPath, Object.values(deps.ledger.snapshot.issues)),
      deps.config.reviewer.requireInvocationPrefix,
    )
    const reviewResponse = parseReviewerIssues((await deps.reviewer.promptText(reviewPrompt)).text)
    const records = [...applyReviewRound(deps.ledger, round, reviewResponse.issues)]
    await saveIssueLedger(deps.ledger)

    if (records.length === 0) {
      await saveRunState(deps.runState)
      return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
    }

    let fixedThisRound = 0
    for (const record of records) {
      const { fixedThisIssue } = await processIssueVerifyFix(record, deps)
      if (fixedThisIssue) {
        fixedThisRound += 1
      }
    }

    const rereviewResponse = parseReviewerIssues(
      (
        await deps.reviewer.promptText(
          buildRereviewPrompt(deps.runState.planPath, Object.values(deps.ledger.snapshot.issues)),
        )
      ).text,
    )

    const unresolvedFingerprints = new Set(rereviewResponse.issues.map((issue) => computeIssueFingerprint(issue)))
    applyReviewRound(deps.ledger, round, rereviewResponse.issues)

    for (const record of Object.values(deps.ledger.snapshot.issues)) {
      if (record.status === 'fixed_pending_review' && !unresolvedFingerprints.has(record.fingerprint)) {
        record.status = 'closed'
      }
    }

    if (rereviewResponse.issues.length === 0) {
      await saveIssueLedger(deps.ledger)
      await saveRunState(deps.runState)
      return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
    }

    noProgressRounds = fixedThisRound === 0 ? noProgressRounds + 1 : 0
    deps.runState.noProgressRounds = noProgressRounds
    await saveRunState(deps.runState)
    await saveIssueLedger(deps.ledger)

    if (noProgressRounds >= deps.config.maxNoProgressRounds) {
      return { doneReason: 'no_progress', rounds: round, ledger: deps.ledger.snapshot }
    }
  }

  return {
    doneReason: 'max_rounds',
    rounds: deps.runState.currentRound,
    ledger: deps.ledger.snapshot,
  }
}
