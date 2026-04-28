import { expect, test } from 'bun:test'

import { validateOrMigrateProgress } from '../../../scripts/behavior-audit/progress-migrate.js'
import { emptyPhase1b } from '../../../scripts/behavior-audit/progress.js'

const validV4Base = {
  version: 4,
  startedAt: '2026-01-01T00:00:00.000Z',
  phase1: {
    status: 'not-started',
    completedTests: {},
    failedTests: {},
    completedFiles: [],
    stats: { filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
  },
  phase2a: {
    status: 'not-started',
    completedBehaviors: {},
    failedBehaviors: {},
    stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
  },
  phase2b: {
    status: 'not-started',
    completedFeatureKeys: {},
    failedFeatureKeys: {},
    stats: { featureKeysTotal: 0, featureKeysDone: 0, featureKeysFailed: 0, behaviorsConsolidated: 0 },
  },
  phase3: {
    status: 'not-started',
    completedConsolidatedIds: {},
    failedConsolidatedIds: {},
    stats: { consolidatedIdsTotal: 0, consolidatedIdsDone: 0, consolidatedIdsFailed: 0 },
  },
}

test('validateOrMigrateProgress returns a valid v5 progress unchanged', () => {
  const v5 = { ...validV4Base, version: 5, phase1b: emptyPhase1b() }
  const result = validateOrMigrateProgress(v5)
  expect(result).not.toBeNull()
  expect(result?.version).toBe(5)
  expect(result?.phase1b).toEqual(emptyPhase1b())
})

test('validateOrMigrateProgress migrates v4 to v5 by injecting emptyPhase1b', () => {
  const result = validateOrMigrateProgress(validV4Base)
  expect(result).not.toBeNull()
  expect(result?.version).toBe(5)
  expect(result?.phase1b).toEqual(emptyPhase1b())
  expect(result?.phase1.stats.filesTotal).toBe(0)
  expect(result?.phase2a.status).toBe('not-started')
})

test('validateOrMigrateProgress migrates v4 and preserves existing phase data', () => {
  const v4WithData = {
    ...validV4Base,
    phase1: {
      ...validV4Base.phase1,
      status: 'done',
      stats: { filesTotal: 10, filesDone: 10, testsExtracted: 50, testsFailed: 2 },
    },
    phase2a: {
      ...validV4Base.phase2a,
      status: 'in-progress',
      stats: { behaviorsTotal: 50, behaviorsDone: 20, behaviorsFailed: 1 },
    },
  }
  const result = validateOrMigrateProgress(v4WithData)
  expect(result?.phase1.status).toBe('done')
  expect(result?.phase1.stats.testsExtracted).toBe(50)
  expect(result?.phase2a.status).toBe('in-progress')
  expect(result?.phase2a.stats.behaviorsDone).toBe(20)
  expect(result?.phase1b).toEqual(emptyPhase1b())
})

test('validateOrMigrateProgress resets incompatible progress preserving startedAt', () => {
  const incompatible = { startedAt: '2025-12-01T00:00:00.000Z', someGarbage: true }
  const result = validateOrMigrateProgress(incompatible)
  expect(result).not.toBeNull()
  expect(result?.version).toBe(5)
  expect(result?.startedAt).toBe('2025-12-01T00:00:00.000Z')
  expect(result?.phase1.status).toBe('not-started')
  expect(result?.phase1b).toEqual(emptyPhase1b())
})

test('validateOrMigrateProgress returns null for completely unrecognizable input', () => {
  expect(validateOrMigrateProgress(null)).toBeNull()
  expect(validateOrMigrateProgress(42)).toBeNull()
  expect(validateOrMigrateProgress({})).toBeNull()
})
