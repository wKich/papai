import { describe, expect, mock, test } from 'bun:test'

import { runBehaviorAudit, type BehaviorAuditDeps } from '../../scripts/behavior-audit.ts'
import type {
  ConsolidatedManifest,
  IncrementalManifest,
  IncrementalSelection,
} from '../../scripts/behavior-audit/incremental.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, createIncrementalManifestFixture } from './behavior-audit-integration.helpers.js'

function createEmptyProgress(filesTotal: number): Progress {
  return createEmptyProgressFixture(filesTotal)
}

function createSelection(overrides: Partial<IncrementalSelection> = {}): IncrementalSelection {
  return {
    phase1SelectedTestKeys: [],
    phase2aSelectedTestKeys: [],
    phase2bSelectedCandidateFeatureKeys: [],
    phase3SelectedConsolidatedIds: [],
    reportRebuildOnly: false,
    ...overrides,
  }
}

describe('behavior-audit interrupted-run baseline', () => {
  test('interrupted first run still seeds next incremental baseline from lastStartCommit', async () => {
    const selectedKey = 'tests/tools/sample.test.ts::suite > case'
    const parsedFiles = [
      parseTestFile(
        'tests/tools/sample.test.ts',
        ["describe('suite', () => {", "  test('case', () => {})", '})', ''].join('\n'),
      ),
    ]
    const selectionInputs: Array<{
      readonly previousManifest: IncrementalManifest
      readonly updatedManifest: IncrementalManifest
      readonly previousLastStartCommit: string | null
    }> = []
    const progress = createEmptyProgress(1)
    const consolidatedManifest: ConsolidatedManifest = { version: 1, entries: {} }
    const firstPreviousManifest = createIncrementalManifestFixture({
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {},
    })
    const firstUpdatedManifest = createIncrementalManifestFixture({
      ...firstPreviousManifest,
      lastStartCommit: 'head-1',
      lastStartedAt: '2026-04-22T10:00:00.000Z',
      tests: {},
    })
    const secondUpdatedManifest = createIncrementalManifestFixture({
      ...firstUpdatedManifest,
      lastStartCommit: 'head-2',
      lastStartedAt: '2026-04-22T11:00:00.000Z',
      tests: firstUpdatedManifest.tests,
    })

    let runCount = 0
    const runPhase1SelectedKeys: string[][] = []

    const deps: BehaviorAuditDeps = {
      requireOpenAiApiKey: () => {},
      prepareIncrementalRun: () => {
        runCount += 1
        if (runCount === 1) {
          return Promise.resolve({
            previousManifest: firstPreviousManifest,
            previousLastStartCommit: null,
            updatedManifest: firstUpdatedManifest,
          })
        }
        return Promise.resolve({
          previousManifest: firstUpdatedManifest,
          previousLastStartCommit: 'head-1',
          updatedManifest: secondUpdatedManifest,
        })
      },
      selectIncrementalRunWork: (input) => {
        selectionInputs.push(input)
        return Promise.resolve({
          parsedFiles,
          previousConsolidatedManifest: null,
          selection: createSelection({
            phase1SelectedTestKeys: [selectedKey],
            phase2aSelectedTestKeys: [selectedKey],
          }),
        })
      },
      loadOrCreateProgress: () => Promise.resolve(progress),
      rebuildReportsFromStoredResults: () => Promise.resolve(),
      runPhase1IfNeeded: (_parsedFiles, _progress, selectedTestKeys) => {
        runPhase1SelectedKeys.push([...selectedTestKeys].toSorted())
        return Promise.resolve()
      },
      runPhase2aIfNeeded: () => Promise.resolve(new Set()),
      runPhase2bIfNeeded: () => {
        if (runCount === 1) {
          return Promise.reject(new Error('simulated interruption after run start'))
        }
        return Promise.resolve(consolidatedManifest)
      },
      saveConsolidatedManifest: () => Promise.resolve(),
      runPhase3IfNeeded: () => Promise.resolve(),
      log: { log: mock(() => {}) },
    }

    await expect(runBehaviorAudit(deps)).rejects.toThrow('simulated interruption after run start')

    await runBehaviorAudit(deps)

    expect(selectionInputs[1]).toEqual({
      previousManifest: firstUpdatedManifest,
      updatedManifest: secondUpdatedManifest,
      previousLastStartCommit: 'head-1',
    })
    expect(runPhase1SelectedKeys[1]).toEqual([selectedKey])
  })
})
