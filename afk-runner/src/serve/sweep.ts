// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { ServeFs } from './fs-seam.js'

/**
 * The board's change detection (web-board D5): a polling mtime sweep — a pure
 * "scan run dirs → changed run ids" over memoized (size, mtime) fingerprints.
 * `fs.watch` is the later optimization; polling is portable, torn-tail-safe by
 * construction (the existing readEvents tolerance applies per read, so a torn
 * tail is just a size change), and roster growth counts as a change.
 */

export interface FileFingerprint {
  readonly size: number
  readonly mtimeMs: number
}

export interface RunFingerprint {
  readonly events: FileFingerprint | null
  readonly memo: FileFingerprint | null
}

export type RosterFingerprints = Readonly<Record<string, RunFingerprint>>

export interface SweepResult {
  readonly changed: readonly string[]
  readonly roster: RosterFingerprints
}

export function emptyRoster(): RosterFingerprints {
  return {}
}

async function fingerprintOf(fs: ServeFs, filePath: string): Promise<FileFingerprint | null> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null
  } catch {
    return null
  }
}

async function runFingerprintOf(fs: ServeFs, runDir: string): Promise<RunFingerprint | null> {
  try {
    if (!(await fs.stat(runDir)).isDirectory()) return null
  } catch {
    return null
  }
  return {
    events: await fingerprintOf(fs, path.join(runDir, 'events.ndjson')),
    memo: await fingerprintOf(fs, path.join(runDir, 'state.json')),
  }
}

function sameFingerprint(a: FileFingerprint | null, b: FileFingerprint | null): boolean {
  return a === null && b === null ? true : a !== null && b !== null && a.size === b.size && a.mtimeMs === b.mtimeMs
}

function sameRun(a: RunFingerprint | null, b: RunFingerprint | null): boolean {
  return sameFingerprint(a?.events ?? null, b?.events ?? null) && sameFingerprint(a?.memo ?? null, b?.memo ?? null)
}

export async function sweepRuns(fs: ServeFs, workDir: string, previous: RosterFingerprints): Promise<SweepResult> {
  const entries = await fs.readdir(path.join(workDir, 'runs')).catch(() => [] as string[])
  const fingerprints = await Promise.all(
    entries.map(async (runId) => ({
      runId,
      fingerprint: await runFingerprintOf(fs, path.join(workDir, 'runs', runId)),
    })),
  )
  const roster: Record<string, RunFingerprint> = {}
  const changed: string[] = []
  for (const { runId, fingerprint } of fingerprints) {
    if (fingerprint === null) continue
    roster[runId] = fingerprint
    const prior = previous[runId]
    if (prior === undefined || !sameRun(prior, fingerprint)) changed.push(runId)
  }
  for (const runId of Object.keys(previous)) {
    if (roster[runId] === undefined) changed.push(runId)
  }
  return { changed, roster }
}
