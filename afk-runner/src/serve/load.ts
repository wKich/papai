// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import pLimit from 'p-limit'

import type { SddEvent } from '../events.js'
import { readEvents } from '../events.js'
import { readAllRunStates } from '../run-index.js'
import type { ServeFs } from './fs-seam.js'
import { buildRunDetail } from './run-detail.js'
import type { RecentEvent, RunDetailView } from './run-detail.js'
import { eventsPageOf } from './run-detail.js'
import type { PortfolioView, RunView } from './view-model.js'
import { buildPortfolio, buildRunView } from './view-model.js'

/**
 * The board's fs tolerance shell: roster from the run-index memos, views from
 * the fold — a missing or corrupt log degrades the row instead of failing the
 * board, and torn-tail tolerance rides `readEvents` (no new tolerance logic).
 * The pending-gate read is the board's own file access and goes through the
 * read-only seam (web-board D4).
 */

const FOLD_CONCURRENCY = 4

const quietTornTail = (): void => undefined

function readRunEvents(workDir: string, runId: string): readonly SddEvent[] | null {
  try {
    return readEvents(path.join(workDir, 'runs', runId, 'events.ndjson'), quietTornTail)
  } catch {
    return null
  }
}

export async function loadPortfolio(workDir: string, now: Date = new Date()): Promise<PortfolioView> {
  const roster = await readAllRunStates(workDir)
  const limit = pLimit(FOLD_CONCURRENCY)
  const cards = await Promise.all(
    roster.map((memo) =>
      limit((): Promise<RunView> =>
        Promise.resolve(
          buildRunView({ runId: memo.runId, memo, events: readRunEvents(workDir, memo.runId), now: now.getTime() }),
        ),
      ),
    ),
  )
  return buildPortfolio(cards)
}

export async function loadRunDetail(
  fs: ServeFs,
  workDir: string,
  runId: string,
  now: Date = new Date(),
): Promise<RunDetailView | null> {
  const memo = (await readAllRunStates(workDir)).find((entry) => entry.runId === runId)
  if (memo === undefined) return null
  const events = readRunEvents(workDir, runId)
  const pendingGate = buildRunView({ runId, memo, events, now: now.getTime() }).gate
  const gateContent =
    pendingGate === null
      ? null
      : await fs.readFile(path.join(workDir, 'runs', runId, `gate-${pendingGate.version}.md`)).catch(() => null)
  return buildRunDetail({ runId, memo, events, now: now.getTime(), gateContent })
}

export interface RunEventsPage {
  readonly events: readonly RecentEvent[]
}

/** One history page (tool-reports D3): the last `limit` feed events strictly below `before`. */
export async function loadRunEventsPage(
  workDir: string,
  runId: string,
  before: number,
  limit: number,
): Promise<RunEventsPage | null> {
  const memo = (await readAllRunStates(workDir)).find((entry) => entry.runId === runId)
  if (memo === undefined) return null
  return { events: eventsPageOf(readRunEvents(workDir, runId) ?? [], before, limit) }
}
