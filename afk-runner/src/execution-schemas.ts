// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * Vocabulary widened by U3 (extracted from event-schemas.ts at the
 * max-lines seam): the stage union with the execution states, the gate-mode
 * union with release, and the execution-walk fact events. Additive by
 * construction — pre-U3 logs carry none of the new values.
 */

export const StageIdSchema = z.enum([
  'intake',
  'draft',
  'review',
  'decompose',
  'atomicity',
  'gate',
  'implement',
  'verify',
  'release',
])
export type StageId = z.infer<typeof StageIdSchema>

export const STAGE_ORDER: readonly StageId[] = [
  'intake',
  'draft',
  'review',
  'decompose',
  'atomicity',
  'gate',
  'implement',
  'verify',
  'release',
]

/** The gate-mode union — widened with `release` (U3 D7); re-exported from event-schemas.js. */
export const GateModeSchema = z.enum(['early', 'final', 'plan', 'escalation', 'release'])
export type GateMode = z.infer<typeof GateModeSchema>

/** Execution arming (U3 D1): one fact event per armed start; unarmed runs carry none. */
export const ExecutionEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('execution'),
  action: z.literal('armed'),
})

/** Per-task walk facts (U3 D4): attempts derive from started counts, status from the last event per id. */
export const TaskEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('task'),
  action: z.enum(['started', 'done', 'failed']),
  id: z.string().min(1),
  detail: z.string().optional(),
})
