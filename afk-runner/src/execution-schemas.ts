// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * Execution-walk L2 variants (U3), extracted from event-schemas.ts at the
 * max-lines seam — the armed fact and the per-task walk events. Additive by
 * construction: pre-U3 logs carry none of them.
 */

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
