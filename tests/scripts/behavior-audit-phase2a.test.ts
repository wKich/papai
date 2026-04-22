import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'

import type { Phase2aDeps } from '../../scripts/behavior-audit/classify.js'
import type { IncrementalManifest } from '../../scripts/behavior-audit/incremental.js'
import {
  createAuditBehaviorPaths,
  createClassifiedBehaviorFixture,
  createExtractedBehaviorFixture,
  createManifestTestEntry,
  mockAuditBehaviorConfig,
} from './behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import {
  getManifestEntry,
  importWithGuard,
  isClassifyModule,
  loadIncrementalModule,
  loadProgressModule,
  type MockClassificationResult,
  readSavedManifest,
} from './behavior-audit-integration.support.js'

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

describe('behavior-audit phase 2a classification', () => {
  let root: string
  let auditRoot: string
  let progressPath: string
  let manifestPath: string
  let classifyBehaviorWithRetryCalls: number
  let classifyBehaviorWithRetryImpl: Phase2aDeps['classifyBehaviorWithRetry']

  beforeEach(() => {
    root = makeTempDir()
    const paths = createAuditBehaviorPaths(root)
    auditRoot = paths.auditBehaviorDir
    progressPath = paths.progressPath
    manifestPath = paths.incrementalManifestPath
    classifyBehaviorWithRetryCalls = 0
    classifyBehaviorWithRetryImpl = (): Promise<MockClassificationResult> =>
      Promise.resolve({
        visibility: 'user-facing',
        candidateFeatureKey: 'task-creation',
        candidateFeatureLabel: 'Task creation',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Matches task creation flow.',
      })

    mockAuditBehaviorConfig(root, {
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      EXCLUDED_PREFIXES: [] as const,
    })
  })

  function createPhase2aDeps(): Pick<Phase2aDeps, 'classifyBehaviorWithRetry'> {
    return {
      classifyBehaviorWithRetry: (prompt: string, attemptOffset: number): Promise<MockClassificationResult> => {
        classifyBehaviorWithRetryCalls += 1
        return classifyBehaviorWithRetryImpl(prompt, attemptOffset)
      },
    }
  }

  test('runPhase2a classifies selected extracted behaviors and returns dirty candidate feature keys', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        'tests/tools/sample.test.ts::suite > case': createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: 'stale-phase2-fp',
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    progress.phase1.extractedBehaviors['tests/tools/sample.test.ts::suite > case'] = createExtractedBehaviorFixture({
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls create_task and returns the new task.',
      keywords: ['task-create'],
    })

    const dirty = await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect([...dirty]).toEqual(['task-creation'])
    const classifiedBehavior = progress.phase2a.classifiedBehaviors['tests/tools/sample.test.ts::suite > case']
    if (classifiedBehavior === undefined) {
      throw new Error('Expected classified behavior to be stored')
    }
    expect(classifiedBehavior.candidateFeatureKey).toBe('task-creation')

    const classifiedPath = path.join(auditRoot, 'classified', 'tools.json')
    expect(await Bun.file(classifiedPath).exists()).toBe(true)

    const classifiedRaw: unknown = JSON.parse(await Bun.file(classifiedPath).text())
    expect(classifiedRaw).toEqual([
      {
        behaviorId: 'tests/tools/sample.test.ts::suite > case',
        testKey: 'tests/tools/sample.test.ts::suite > case',
        domain: 'tools',
        behavior: 'When the user creates a task, the bot saves it.',
        context: 'Calls create_task and returns the new task.',
        keywords: ['task-create'],
        visibility: 'user-facing',
        candidateFeatureKey: 'task-creation',
        candidateFeatureLabel: 'Task creation',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Matches task creation flow.',
      },
    ])

    const savedManifest = await readSavedManifest(manifestPath)
    const savedEntry = getManifestEntry(savedManifest, 'tests/tools/sample.test.ts::suite > case')
    expect(savedEntry.phase2aFingerprint).toBeTruthy()
    expect(savedEntry.phase2Fingerprint).toBe('stale-phase2-fp')
    expect(savedEntry.lastPhase2aCompletedAt).toBeTruthy()
    expect(savedEntry.lastPhase2CompletedAt).toBeNull()

    const progressText = await Bun.file(progressPath).text()
    expect(progressText).toContain('task-creation')
  })

  test('runPhase2a skips already-completed classifications on resumed runs', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > case'
    const existingClassified = createClassifiedBehaviorFixture({
      behaviorId: testKey,
      testKey,
      domain: 'tools',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls create_task and returns the new task.',
      keywords: ['task-create'],
      visibility: 'user-facing',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      classificationNotes: 'Persisted from a prior run.',
    })

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2aFingerprint: incremental.buildPhase2aFingerprint({
            testKey,
            behavior: 'When the user creates a task, the bot saves it.',
            context: 'Calls create_task and returns the new task.',
            keywords: ['task-create'],
            phaseVersion: 'phase2-v1',
          }),
          phase2Fingerprint: 'phase2-fp',
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          behaviorId: testKey,
          candidateFeatureKey: 'task-creation',
          lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: '2026-04-21T12:05:00.000Z',
        }),
      },
    }
    progress.phase1.extractedBehaviors[testKey] = {
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls create_task and returns the new task.',
      keywords: ['task-create'],
    }
    progress.phase2a.completedBehaviors[testKey] = 'done'
    progress.phase2a.classifiedBehaviors[testKey] = existingClassified

    const dirty = await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect(classifyBehaviorWithRetryCalls).toBe(0)
    expect([...dirty]).toEqual(['task-creation'])
    expect(progress.phase2a.classifiedBehaviors[testKey]).toEqual(existingClassified)
    expect(await Bun.file(path.join(auditRoot, 'classified', 'tools.json')).exists()).toBe(false)
  })

  test('runPhase2a reruns explicitly selected completed classifications when stored phase2a metadata is stale', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > case'

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v2', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2aFingerprint: 'stale-phase2a-fp',
          phase2Fingerprint: 'phase2-fp',
          behaviorId: testKey,
          candidateFeatureKey: 'task-creation',
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
          lastPhase2CompletedAt: '2026-04-21T12:05:00.000Z',
        }),
      },
    }

    progress.phase1.extractedBehaviors[testKey] = createExtractedBehaviorFixture({
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls create_task and returns the new task.',
      keywords: ['task-create'],
    })
    progress.phase2a.completedBehaviors[testKey] = 'done'
    progress.phase2a.classifiedBehaviors[testKey] = createClassifiedBehaviorFixture({
      behaviorId: testKey,
      testKey,
      domain: 'tools',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls create_task and returns the new task.',
      keywords: ['task-create'],
      visibility: 'internal',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      classificationNotes: 'Stale prior classification.',
    })

    classifyBehaviorWithRetryImpl = (): Promise<MockClassificationResult> =>
      Promise.resolve({
        visibility: 'user-facing',
        candidateFeatureKey: 'task-creation',
        candidateFeatureLabel: 'Task creation',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Refreshed classification.',
      })

    const dirty = await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    expect([...dirty]).toEqual(['task-creation'])
    const refreshedBehavior = progress.phase2a.classifiedBehaviors[testKey]
    if (refreshedBehavior === undefined) {
      throw new Error('Expected refreshed classified behavior')
    }
    expect(refreshedBehavior.visibility).toBe('user-facing')
  })

  test('runPhase2a passes persisted retry attempt offset through to the classifier on resumed failures', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > case'
    const classifierArgs: Array<readonly [string, number]> = []

    classifyBehaviorWithRetryImpl = (prompt: string, attemptOffset: number): Promise<MockClassificationResult> => {
      classifierArgs.push([prompt, attemptOffset])
      return Promise.resolve({
        visibility: 'user-facing',
        candidateFeatureKey: 'task-creation',
        candidateFeatureLabel: 'Task creation',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Resumed from prior failed attempt.',
      })
    }

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    progress.phase1.extractedBehaviors[testKey] = {
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls create_task and returns the new task.',
      keywords: ['task-create'],
    }
    progress.phase2a.failedBehaviors[testKey] = {
      error: 'classification failed after retries',
      attempts: 2,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }

    await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    expect(classifierArgs).toHaveLength(1)
    const classifierArgsEntry = classifierArgs[0]
    if (classifierArgsEntry === undefined) {
      throw new Error('Expected classifier args entry')
    }
    expect(classifierArgsEntry[1]).toBe(2)
  })

  test('runPhase2a clears stale phase2a failure state after a later successful classification', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > recovery case'

    classifyBehaviorWithRetryImpl = (): Promise<MockClassificationResult> =>
      Promise.resolve({
        visibility: 'user-facing',
        candidateFeatureKey: 'task-recovery',
        candidateFeatureLabel: 'Task recovery',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Recovered successfully.',
      })

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > recovery case',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    progress.phase1.extractedBehaviors[testKey] = {
      testName: 'recovery case',
      fullPath: 'suite > recovery case',
      behavior: 'When the user retries task creation, the bot recovers successfully.',
      context: 'Repeats the classification after a transient failure.',
      keywords: ['task-recovery'],
    }
    progress.phase2a.failedBehaviors[testKey] = {
      error: 'classification failed after retries',
      attempts: 1,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }
    progress.phase2a.stats.behaviorsFailed = 1

    const dirty = await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect([...dirty]).toEqual(['task-recovery'])
    expect(progress.phase2a.failedBehaviors[testKey]).toBeUndefined()
    expect(progress.phase2a.stats.behaviorsFailed).toBe(0)
    const recoveredBehavior = progress.phase2a.classifiedBehaviors[testKey]
    if (recoveredBehavior === undefined) {
      throw new Error('Expected recovered classified behavior')
    }
    expect(recoveredBehavior.candidateFeatureKey).toBe('task-recovery')
  })

  test('runPhase2a does not exceed total retry budget across resumed failed runs', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > exhausted retries'

    classifyBehaviorWithRetryImpl = (): Promise<MockClassificationResult> => Promise.resolve(null)

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > exhausted retries',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    progress.phase1.extractedBehaviors[testKey] = {
      testName: 'exhausted retries',
      fullPath: 'suite > exhausted retries',
      behavior: 'When classification keeps failing, retries should stop at the total budget.',
      context: 'Exercises resume behavior after all classifier attempts are consumed.',
      keywords: ['classification-retries'],
    }

    await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    const firstFailure = progress.phase2a.failedBehaviors[testKey]
    if (firstFailure === undefined) {
      throw new Error('Expected failed behavior entry')
    }
    expect(firstFailure.attempts).toBe(3)

    await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      createPhase2aDeps(),
    )

    expect(classifyBehaviorWithRetryCalls).toBe(1)
    const repeatedFailure = progress.phase2a.failedBehaviors[testKey]
    if (repeatedFailure === undefined) {
      throw new Error('Expected repeated failed behavior entry')
    }
    expect(repeatedFailure.attempts).toBe(3)
  })

  test('runPhase2a honors an injected total retry budget for resumed failures', async () => {
    const classify = await importWithGuard(
      `../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`,
      isClassifyModule,
      'Unexpected classify module shape',
    )
    const progressModule = await loadProgressModule(crypto.randomUUID())
    const incremental = await loadIncrementalModule(crypto.randomUUID())
    const testKey = 'tests/tools/sample.test.ts::suite > custom retry budget'

    const progress = progressModule.createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...incremental.createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [testKey]: createManifestTestEntry({
          testFile: 'tests/tools/sample.test.ts',
          testName: 'suite > custom retry budget',
          dependencyPaths: ['tests/tools/sample.test.ts'],
          phase1Fingerprint: 'phase1-fp',
          phase2Fingerprint: null,
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/sample.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
          lastPhase2CompletedAt: null,
        }),
      },
    }
    progress.phase1.extractedBehaviors[testKey] = {
      testName: 'custom retry budget',
      fullPath: 'suite > custom retry budget',
      behavior: 'When classification keeps failing, the injected retry budget caps resumed runs.',
      context: 'Exercises resume behavior after a custom retry budget is exhausted.',
      keywords: ['classification-retries'],
    }
    progress.phase2a.failedBehaviors[testKey] = {
      error: 'classification failed after retries',
      attempts: 2,
      lastAttempt: '2026-04-21T12:04:00.000Z',
    }

    await classify.runPhase2a(
      {
        progress,
        selectedTestKeys: new Set([testKey]),
        manifest,
      },
      {
        ...createPhase2aDeps(),
        maxRetries: 2,
      } as Partial<Phase2aDeps>,
    )

    expect(classifyBehaviorWithRetryCalls).toBe(0)
    const repeatedFailure = progress.phase2a.failedBehaviors[testKey]
    if (repeatedFailure === undefined) {
      throw new Error('Expected repeated failed behavior entry')
    }
    expect(repeatedFailure.attempts).toBe(2)
  })
})
