// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { WorkIO } from '../drive/loop.js'
import type { KernelContext } from '../kernel/machine.js'
import type { RunCheckFn } from './run-check.js'

/**
 * The execution boundary's gate set (U3 D5): compiled constants — the
 * exact membership is tunable on drill evidence without spec motion.
 */
export const VERIFY_CHECKS: readonly (readonly string[])[] = [
  ['bun', 'run', 'typecheck'],
  ['bun', 'run', 'lint'],
  ['bun', 'run', 'test', '--', '--serial'],
]

export type VerifyVerdict = 'green' | 'red'

export interface VerifyDeps {
  readonly runCheck: RunCheckFn
  readonly runDir: string
  readonly cwd: string
}

/** The verify log version numbers present in the run dir. */
function verifyVersions(runDir: string): number[] {
  let names: string[]
  try {
    names = readdirSync(runDir)
  } catch {
    return []
  }
  return names
    .map((name) => /^verify-(\d+)\.log$/u.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
}

/** The newest verify log path — the fix context implement re-targets from (U3 D4/D5). */
export function newestVerifyLogPath(runDir: string): string | null {
  const versions = verifyVersions(runDir)
  if (versions.length === 0) return null
  return path.join(runDir, `verify-${String(Math.max(...versions))}.log`)
}

/** The newest verify log's verdict — the log artifact is the red truth (U3 D5). */
export function newestVerifyVerdict(runDir: string): VerifyVerdict | null {
  const logPath = newestVerifyLogPath(runDir)
  if (logPath === null) return null
  let body: string
  try {
    body = readFileSync(logPath, 'utf8')
  } catch {
    return null
  }
  const lines = body.split('\n').filter((line) => line.length > 0)
  const last = lines[lines.length - 1]
  if (last === 'verdict: green') return 'green'
  if (last === 'verdict: red') return 'red'
  return null
}

/**
 * The boundary work (U3 D5): run the compiled gate set through the check
 * seam, write verify-&lt;n&gt;.log at the next version, and never throw on
 * red — red is routing, not a declared failure; the log artifact is what
 * the outcome reader and the fix prompt consume.
 */
export async function runVerifyWork(deps: VerifyDeps, _io: WorkIO): Promise<void> {
  const checks = await Promise.all(VERIFY_CHECKS.map((command) => deps.runCheck(deps.cwd, [...command])))
  const sections = VERIFY_CHECKS.map((command, index) => {
    const check = checks[index]
    if (check === undefined) return ''
    const parts = [
      `$ ${command.join(' ')}`,
      check.stdout.trimEnd(),
      check.stderr.trimEnd(),
      `exit ${String(check.exitCode)}`,
    ]
    return parts.filter((part) => part.length > 0).join('\n')
  })
  const green = checks.every((check) => check.exitCode === 0)
  const versions = verifyVersions(deps.runDir)
  const next = (versions.length === 0 ? 0 : Math.max(...versions)) + 1
  const body = `${sections.join('\n\n')}\nverdict: ${green ? 'green' : 'red'}\n`
  writeFileSync(path.join(deps.runDir, `verify-${String(next)}.log`), body)
}

/**
 * The verify outcome (U3 D5): an open bracket always owes the boundary —
 * a stale red log never routes around a re-run — and a closed bracket
 * reads the newest log's verdict (no log re-owns the boundary).
 */
export function verifyOutcomeOf(context: KernelContext, verdict: VerifyVerdict | null): 'unverified' | 'green' | 'red' {
  if (context.stages['verify'] !== 'done') return 'unverified'
  if (verdict === 'green') return 'green'
  if (verdict === 'red') return 'red'
  return 'unverified'
}
