// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assign, initialTransition, setup, transition } from 'xstate'
import type { ExecutableActionsFrom, SnapshotFrom } from 'xstate'

import { digestRecordOf } from '../legacy-fold.js'
import type { AutoDecisionRecord } from '../legacy-fold.js'
import type { KernelContext, KernelEvent, RoundTally, StageStatus, TallyCounts } from './types.js'
import { initialKernelContext } from './types.js'

export type {
  ChildRecord,
  ChildStatus,
  GateRecord,
  KernelContext,
  KernelEvent,
  RoundStatus,
  RoundTally,
  StageStatus,
  TaskRecord,
  TaskStatus,
  TallyCounts,
} from './types.js'
export { initialKernelContext } from './types.js'

export const kernelSetup = setup({
  guards: {
    isStage: ({ event }: { event: KernelEvent }, params: { stage: string }) =>
      event.type === 'stage.enter' && event.stage === params.stage,
    /**
     * C5 reshape (D4): the gate stage done and nothing active — the all-done
     * requirement made depth-S completion graph-impossible (the map is
     * pre-initialized all-pending, so atomicity never leaves `pending` on an
     * S run). Guard-equivalent over every historical answered: interstitial
     * gates keep the gate stage pending (blocked), completed shapes have all
     * done (fires) — the only flip is the intended S final approve.
     */
    allStagesDone: ({ context }: { context: KernelContext }) =>
      context.stages['gate'] === 'done' && Object.values(context.stages).every((status) => status !== 'active'),
    /** Abort exits are new-log-only (D2): a historical answered event carries no outcome and never aborts. */
    isAbortOutcome: ({ event }: { event: KernelEvent }) => event.type === 'gate.answered' && event.outcome === 'abort',
  },
  actions: {
    closeThenActivate: assign(({ context, event }) => {
      if (event.type !== 'stage.enter') return {}
      const stages: Record<string, StageStatus> = { ...context.stages }
      for (const id of Object.keys(stages)) if (stages[id] === 'active') stages[id] = 'done'
      stages[event.stage] = 'active'
      return { stages }
    }),
    markStageDone: assign(({ context, event }) => {
      if (event.type !== 'stage.exit') return {}
      // A stage's exit closes its bracket successfully — its failure ledger
      // entry resets (C6 D2: a later failure of the same stage counts fresh).
      const failures = Object.fromEntries(Object.entries(context.failures).filter(([stage]) => stage !== event.stage))
      const failureKinds = Object.fromEntries(
        Object.entries(context.failureKinds).filter(([stage]) => stage !== event.stage),
      )
      return { stages: { ...context.stages, [event.stage]: 'done' }, failures, failureKinds }
    }),
    recordFailure: assign(({ context, event }) => {
      if (event.type !== 'stage.failed') return {}
      return {
        failures: { ...context.failures, [event.stage]: (context.failures[event.stage] ?? 0) + 1 },
        failureKinds: { ...context.failureKinds, [event.stage]: event.kind },
      }
    }),
    setDepth: assign(({ event }) => {
      if (event.type !== 'depth') return {}
      return { depth: event.profile }
    }),
    openRound: assign(({ event }) => {
      if (event.type !== 'round.open') return {}
      return { round: { current: event.round, cap: event.cap } }
    }),
    tallyFinding: assign(({ context, event }) => {
      if (event.type !== 'finding') return {}
      if (event.action !== 'resolved' && event.action !== 'dismissed') return {}
      const current = context.tally[event.round] ?? { resolved: 0, dismissed: 0 }
      const next: TallyCounts =
        event.action === 'resolved'
          ? { resolved: current.resolved + 1, dismissed: current.dismissed }
          : { resolved: current.resolved, dismissed: current.dismissed + 1 }
      return { tally: { ...context.tally, [event.round]: next } }
    }),
    flushConvergence: assign(({ context, event }) => {
      if (event.type !== 'convergence') return {}
      const counts = context.tally[event.round] ?? { resolved: 0, dismissed: 0 }
      const rest: RoundTally = Object.fromEntries(
        Object.entries(context.tally).filter(([round]) => Number(round) !== event.round),
      )
      const record = digestRecordOf(event, counts)
      return { tally: rest, perRound: [...context.perRound, record], lastVerdict: record }
    }),
    presentGate: assign(({ event }) => {
      if (event.type !== 'gate.presented') return {}
      return {
        gate: { mode: event.mode, version: event.version, answered: false },
        gateOutcome: null,
        gateDeadlineAt: event.deadlineAt ?? null,
        gateDeadlineReArmed: false,
      }
    }),
    reArmGate: assign(({ event }) => {
      if (event.type !== 'gate.rearmed') return {}
      return { gateDeadlineAt: event.deadlineAt, gateDeadlineReArmed: true }
    }),
    answerGate: assign(({ context, event }) => {
      if (event.type !== 'gate.answered') return {}
      if (context.gate === null) return {}
      return {
        gate: { ...context.gate, answered: true },
        ...(event.outcome === undefined ? {} : { gateOutcome: event.outcome }),
      }
    }),
    recordAutoDecision: assign(({ context, event }) => {
      if (event.type !== 'auto.decision') return {}
      const record: AutoDecisionRecord = {
        rule: event.rule,
        decision: event.decision,
        evidenceDigest: event.evidenceDigest,
        gateVersion: event.gateVersion,
        seq: event.seq,
        ts: event.ts,
      }
      return { autoDecisions: [...context.autoDecisions, record] }
    }),
    resetChildren: assign(() => ({ children: {} })),
    spawnChild: assign(({ context, event }) => {
      if (event.type !== 'child.spawned') return {}
      return { children: { ...context.children, [event.child]: { status: 'running' } } }
    }),
    finishChild: assign(({ context, event }) => {
      if (event.type !== 'child.done') return {}
      return { children: { ...context.children, [event.child]: { status: event.outcome } } }
    }),
    armExecution: assign(() => ({ executionArmed: true })),
    startTask: assign(({ context, event }) => {
      if (event.type !== 'task.started') return {}
      const prior = context.tasks[event.id]
      return {
        tasks: {
          ...context.tasks,
          [event.id]: { status: 'running', attempts: (prior?.attempts ?? 0) + 1 },
        },
      }
    }),
    finishTask: assign(({ context, event }) => {
      if (event.type !== 'task.done' && event.type !== 'task.failed') return {}
      const prior = context.tasks[event.id]
      return {
        tasks: {
          ...context.tasks,
          [event.id]: { status: event.type === 'task.done' ? 'done' : 'failed', attempts: prior?.attempts ?? 1 },
        },
      }
    }),
    emit: (_args, _params: { event: KernelEvent }): undefined => undefined,
    schedule: (_args, _params: { work: { kind: string } }): undefined => undefined,
  },
})

/**
 * The shared machine type is deliberately loose: every graph composes
 * `kernelRootHandlers` with its own `states` topology, so the constraint-level
 * config shape (state value `{}`) is the vocabulary all machines share.
 *
 * xstate ≥5.28's routable-states event union degenerates the
 * generic-signature instantiation (`ReturnType<typeof kernelSetup.createMachine>`)
 * to `any` when TypeScript instantiates it at its config constraint. Deriving
 * the type from a config-union-typed probe call instead resolves to the same
 * loose machine type concretely.
 */
type KernelMachineConfig = Parameters<typeof kernelSetup.createMachine>[0]

const kernelMachineProbeConfig: KernelMachineConfig = {
  id: 'kernel-machine-probe',
  context: initialKernelContext({}),
}
const kernelMachineProbe = kernelSetup.createMachine(kernelMachineProbeConfig)

export type KernelMachine = typeof kernelMachineProbe
export type KernelSnapshot = SnapshotFrom<KernelMachine>
export type KernelActions = readonly ExecutableActionsFrom<KernelMachine>[]
export type KernelStep = [snapshot: KernelSnapshot, actions: KernelActions]

/**
 * The root-level target-less bookkeeping vocabulary: everything except
 * enters. Enter edges stay per-state topology; these handlers fire from any
 * state (finals included) and never move position — the mechanism proven for
 * `stage.exit`, extended to the full derived state. Graphs compose this
 * record as their root `on`.
 */
export const kernelRootHandlers: NonNullable<KernelMachineConfig['on']> = {
  'stage.exit': { actions: ['markStageDone'] },
  'stage.failed': { actions: ['recordFailure'] },
  depth: { actions: ['setDepth'] },
  'round.open': { actions: ['openRound'] },
  'round.close': { actions: [] },
  finding: { actions: ['tallyFinding'] },
  convergence: { actions: ['flushConvergence'] },
  'gate.presented': { actions: ['presentGate'] },
  'gate.answered': { actions: ['answerGate'] },
  'gate.rearmed': { actions: ['reArmGate'] },
  'auto.decision': { actions: ['recordAutoDecision'] },
  plan: { actions: ['resetChildren'] },
  'child.spawned': { actions: ['spawnChild'] },
  'child.done': { actions: ['finishChild'] },
  'execution.armed': { actions: ['armExecution'] },
  'task.started': { actions: ['startTask'] },
  'task.done': { actions: ['finishTask'] },
  'task.failed': { actions: ['finishTask'] },
}

export function createKernelMachine(config: Parameters<typeof kernelSetup.createMachine>[0]): KernelMachine {
  return kernelSetup.createMachine(config)
}

export function initialStep(machine: KernelMachine): KernelStep {
  return initialTransition(machine)
}

export function step(machine: KernelMachine, snapshot: KernelSnapshot, event: KernelEvent): KernelStep {
  return transition(machine, snapshot, event)
}
