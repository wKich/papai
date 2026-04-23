import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { runBehaviorAudit, type BehaviorAuditDeps } from '../../scripts/behavior-audit.ts'
import { writeReports } from '../../scripts/behavior-audit/evaluate-reporting.js'
import type { ConsolidatedManifest, IncrementalSelection } from '../../scripts/behavior-audit/incremental.js'
import {
  createConsolidatedManifestEntry,
  createEmptyProgressFixture,
  createIncrementalManifestFixture,
  mockAuditBehaviorConfig,
} from './behavior-audit-integration.helpers.js'
import {
  restoreBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  originalOpenAiApiKey,
  restoreOpenAiApiKey,
} from './behavior-audit-integration.runtime-helpers.js'
import { loadEvaluateModule, type MockEvaluationResult } from './behavior-audit-integration.support.js'

type ConsolidatedArtifactRecord = {
  readonly id: string
  readonly domain: string
  readonly featureName: string
  readonly isUserFacing: boolean
  readonly behavior: string
  readonly userStory: string | null
  readonly context: string
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
}

type EvaluatedArtifactRecord = {
  readonly consolidatedId: string
  readonly maria: NonNullable<MockEvaluationResult>['maria']
  readonly dani: NonNullable<MockEvaluationResult>['dani']
  readonly viktor: NonNullable<MockEvaluationResult>['viktor']
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
  readonly evaluatedAt: string
}

function buildRelativeArtifactPath(directory: 'consolidated' | 'evaluated', featureKey: string): string {
  return path.join('reports', 'audit-behavior', directory, `${featureKey}.json`)
}

async function writeJsonArtifact(filePath: string, value: unknown): Promise<void> {
  mkdirSync(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, JSON.stringify(value, null, 2) + '\n')
}

async function readEvaluatedArtifact(root: string, featureKey: string): Promise<readonly EvaluatedArtifactRecord[]> {
  const filePath = path.join(root, buildRelativeArtifactPath('evaluated', featureKey))
  const EvaluatedArtifactRecordSchema = z
    .object({
      consolidatedId: z.string(),
      maria: z.object({ discover: z.number(), use: z.number(), retain: z.number(), notes: z.string() }),
      dani: z.object({ discover: z.number(), use: z.number(), retain: z.number(), notes: z.string() }),
      viktor: z.object({ discover: z.number(), use: z.number(), retain: z.number(), notes: z.string() }),
      flaws: z.array(z.string()),
      improvements: z.array(z.string()),
      evaluatedAt: z.string(),
    })
    .readonly()
  return z.array(EvaluatedArtifactRecordSchema).parse(JSON.parse(await Bun.file(filePath).text()))
}

function createEvaluationResult(input: {
  readonly maria: NonNullable<MockEvaluationResult>['maria']
  readonly dani: NonNullable<MockEvaluationResult>['dani']
  readonly viktor: NonNullable<MockEvaluationResult>['viktor']
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
}): NonNullable<MockEvaluationResult> {
  return {
    maria: input.maria,
    dani: input.dani,
    viktor: input.viktor,
    flaws: [...input.flaws],
    improvements: [...input.improvements],
  }
}

beforeEach(() => {
  if (originalOpenAiApiKey === undefined) {
    process.env['OPENAI_API_KEY'] = 'test-openai-api-key'
    return
  }

  process.env['OPENAI_API_KEY'] = originalOpenAiApiKey
})

afterEach(() => {
  restoreBehaviorAuditEnv()
  restoreOpenAiApiKey()
  cleanupTempDirs()
})

describe('behavior-audit phase 3 incremental selection', () => {
  let root: string
  let auditRoot: string
  let progressPath: string

  beforeEach(() => {
    root = makeTempDir()
    auditRoot = path.join(root, 'reports', 'audit-behavior')
    progressPath = path.join(auditRoot, 'progress.json')

    mockAuditBehaviorConfig(root, {
      PROGRESS_PATH: progressPath,
    })
  })

  test('runPhase3 writes evaluated artifacts for selected consolidated ids and preserves checkpoint-only progress', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedId = 'task-creation::selected-case'
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)
    const consolidatedManifest: ConsolidatedManifest = {
      version: 1,
      entries: {
        [selectedId]: createConsolidatedManifestEntry({
          consolidatedId: selectedId,
          domain: 'tools',
          featureName: 'Selected case',
          sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
          sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
          supportingInternalBehaviorIds: [],
          isUserFacing: true,
          featureKey,
          consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
          evaluatedArtifactPath: null,
          keywords: ['task-create'],
          sourceDomains: ['tools'],
          phase2Fingerprint: 'phase2-fp',
          phase3Fingerprint: null,
          lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
          lastEvaluatedAt: null,
        }),
      },
    }

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
      {
        id: selectedId,
        domain: 'tools',
        featureName: 'Selected case',
        isUserFacing: true,
        behavior: 'When the selected behavior runs, the bot returns fresh results.',
        userStory: 'As a user, I get the selected behavior outcome.',
        context: 'Selected context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([selectedId]),
        consolidatedManifest,
      },
      {
        evaluateWithRetry: () =>
          Promise.resolve(
            createEvaluationResult({
              maria: { discover: 4, use: 4, retain: 4, notes: 'Selected Maria notes' },
              dani: { discover: 3, use: 3, retain: 3, notes: 'Selected Dani notes' },
              viktor: { discover: 5, use: 5, retain: 5, notes: 'Selected Viktor notes' },
              flaws: ['Selected flaw'],
              improvements: ['Selected improvement'],
            }),
          ),
      },
    )

    expect(progress.phase3.completedConsolidatedIds[selectedId]).toBe('done')
    expect(progress.phase3).not.toHaveProperty('evaluations')

    const evaluatedRecords = await readEvaluatedArtifact(root, featureKey)
    expect(evaluatedRecords).toHaveLength(1)
    expect(evaluatedRecords[0]).toMatchObject({
      consolidatedId: selectedId,
      maria: { discover: 4, use: 4, retain: 4, notes: 'Selected Maria notes' },
      dani: { discover: 3, use: 3, retain: 3, notes: 'Selected Dani notes' },
      viktor: { discover: 5, use: 5, retain: 5, notes: 'Selected Viktor notes' },
      flaws: ['Selected flaw'],
      improvements: ['Selected improvement'],
    })
    expect(typeof evaluatedRecords[0]?.evaluatedAt).toBe('string')
  })

  test('runPhase3 persists evaluation artifacts instead of writing user stories into progress checkpoints', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedId = 'task-creation::selected-case'
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
      {
        id: selectedId,
        domain: 'tools',
        featureName: 'Selected case',
        isUserFacing: true,
        behavior: 'When the selected behavior runs, the bot returns fresh results.',
        userStory: 'As a user, I get the selected behavior outcome.',
        context: 'Selected context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([selectedId]),
        consolidatedManifest: {
          version: 1,
          entries: {
            [selectedId]: createConsolidatedManifestEntry({
              consolidatedId: selectedId,
              domain: 'tools',
              featureName: 'Selected case',
              sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
              sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey,
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
              evaluatedArtifactPath: null,
              keywords: ['task-create'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
          },
        },
      },
      {
        evaluateWithRetry: () =>
          Promise.resolve(
            createEvaluationResult({
              maria: { discover: 4, use: 4, retain: 4, notes: 'Selected Maria notes' },
              dani: { discover: 3, use: 3, retain: 3, notes: 'Selected Dani notes' },
              viktor: { discover: 5, use: 5, retain: 5, notes: 'Selected Viktor notes' },
              flaws: ['Selected flaw'],
              improvements: ['Selected improvement'],
            }),
          ),
      },
    )

    const progressText = await Bun.file(progressPath).text()
    expect(progressText).not.toContain('As a user, I get the selected behavior outcome.')
  })

  test('runPhase3 evaluates newly generated consolidated ids even when selection was based on stale ids', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const staleSelectedId = 'task-creation::old-selected-case'
    const freshSelectedId = 'task-creation::fresh-selected-case'
    const featureKey = 'task-creation'
    const progress = createEmptyProgressFixture(1)

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
      {
        id: freshSelectedId,
        domain: 'tools',
        featureName: 'Fresh selected case',
        isUserFacing: true,
        behavior: 'When the fresh behavior runs, the bot returns the regenerated output.',
        userStory: 'As a user, I get the regenerated selected behavior outcome.',
        context: 'Fresh context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([staleSelectedId]),
        consolidatedManifest: {
          version: 1,
          entries: {
            [freshSelectedId]: createConsolidatedManifestEntry({
              consolidatedId: freshSelectedId,
              domain: 'tools',
              featureName: 'Fresh selected case',
              sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
              sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey,
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
              evaluatedArtifactPath: null,
              keywords: ['task-create'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
          },
        },
      },
      {
        evaluateWithRetry: () =>
          Promise.resolve(
            createEvaluationResult({
              maria: { discover: 4, use: 4, retain: 4, notes: 'Fresh Maria notes' },
              dani: { discover: 4, use: 4, retain: 4, notes: 'Fresh Dani notes' },
              viktor: { discover: 4, use: 4, retain: 4, notes: 'Fresh Viktor notes' },
              flaws: ['Fresh flaw'],
              improvements: ['Fresh improvement'],
            }),
          ),
      },
    )

    expect(progress.phase3.completedConsolidatedIds[freshSelectedId]).toBe('done')
    const evaluatedRecords = await readEvaluatedArtifact(root, featureKey)
    expect(evaluatedRecords[0]?.consolidatedId).toBe(freshSelectedId)
  })

  test('runPhase3 limits stale selected ids to the dirty feature set after reconsolidation', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const staleSelectedId = 'task-creation::old-selected-case'
    const freshSelectedId = 'task-creation::fresh-selected-case'
    const unrelatedId = 'group-routing::stable-case'
    const progress = createEmptyProgressFixture(2)
    const calls: string[] = []

    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', 'task-creation')), [
      {
        id: freshSelectedId,
        domain: 'tools',
        featureName: 'Fresh selected case',
        isUserFacing: true,
        behavior: 'When the fresh behavior runs, the bot returns the regenerated output.',
        userStory: 'As a user, I get the regenerated selected behavior outcome.',
        context: 'Fresh context for phase 3.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])
    await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', 'group-routing')), [
      {
        id: unrelatedId,
        domain: 'tools',
        featureName: 'Unrelated stable case',
        isUserFacing: true,
        behavior: 'When the unrelated behavior runs, the bot returns the stable output.',
        userStory: 'As a user, I get the unrelated stable behavior outcome.',
        context: 'Unrelated context for phase 3.',
        sourceTestKeys: ['tests/tools/group.test.ts::suite > stable case'],
        sourceBehaviorIds: ['tests/tools/group.test.ts::suite > stable case'],
        supportingInternalRefs: [],
      } satisfies ConsolidatedArtifactRecord,
    ])

    await evaluate.runPhase3(
      {
        progress,
        selectedConsolidatedIds: new Set([staleSelectedId]),
        selectedFeatureKeys: new Set(['task-creation']),
        consolidatedManifest: {
          version: 1,
          entries: {
            [freshSelectedId]: createConsolidatedManifestEntry({
              consolidatedId: freshSelectedId,
              domain: 'tools',
              featureName: 'Fresh selected case',
              sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
              sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey: 'task-creation',
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', 'task-creation'),
              evaluatedArtifactPath: null,
              keywords: ['task-create'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
            [unrelatedId]: createConsolidatedManifestEntry({
              consolidatedId: unrelatedId,
              domain: 'tools',
              featureName: 'Unrelated stable case',
              sourceTestKeys: ['tests/tools/group.test.ts::suite > stable case'],
              sourceBehaviorIds: ['tests/tools/group.test.ts::suite > stable case'],
              supportingInternalBehaviorIds: [],
              isUserFacing: true,
              featureKey: 'group-routing',
              consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', 'group-routing'),
              evaluatedArtifactPath: null,
              keywords: ['group-route'],
              sourceDomains: ['tools'],
              phase2Fingerprint: 'phase2-fp-unrelated',
              phase3Fingerprint: null,
              lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
              lastEvaluatedAt: null,
            }),
          },
        },
      },
      {
        evaluateWithRetry: (prompt) => {
          calls.push(prompt)
          return Promise.resolve(
            createEvaluationResult({
              maria: { discover: 4, use: 4, retain: 4, notes: 'Scoped Maria notes' },
              dani: { discover: 4, use: 4, retain: 4, notes: 'Scoped Dani notes' },
              viktor: { discover: 4, use: 4, retain: 4, notes: 'Scoped Viktor notes' },
              flaws: ['Scoped flaw'],
              improvements: ['Scoped improvement'],
            }),
          )
        },
      },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('Fresh selected case')
    expect(calls[0]).not.toContain('Unrelated stable case')
    expect(progress.phase3.completedConsolidatedIds[freshSelectedId]).toBe('done')
    expect(progress.phase3.completedConsolidatedIds[unrelatedId]).toBeUndefined()

    const selectedFeatureRecords = await readEvaluatedArtifact(root, 'task-creation')
    expect(selectedFeatureRecords).toHaveLength(1)
    expect(selectedFeatureRecords[0]?.consolidatedId).toBe(freshSelectedId)
    const unrelatedFeatureArtifact = Bun.file(path.join(root, buildRelativeArtifactPath('evaluated', 'group-routing')))
    expect(await unrelatedFeatureArtifact.exists()).toBe(false)
  })
})

test('runPhase3 reads consolidated artifacts using feature keys from manifest entries', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, {
    EXCLUDED_PREFIXES: [] as const,
  })

  const featureKey = 'group-targeting'
  const consolidatedId = 'group-targeting::feature'
  await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('consolidated', featureKey)), [
    {
      id: consolidatedId,
      domain: 'cross-domain',
      featureName: 'Shared group targeting',
      isUserFacing: true,
      behavior: 'When a user targets a group, the bot routes the request correctly.',
      userStory: 'As a user, I can target a group.',
      context: 'Routes through group context selection.',
      sourceTestKeys: ['tests/tools/a.test.ts::suite > case'],
      sourceBehaviorIds: ['tests/tools/a.test.ts::suite > case'],
      supportingInternalRefs: [],
    } satisfies ConsolidatedArtifactRecord,
  ])

  const evaluate = await loadEvaluateModule(`phase3-keyword-files-${crypto.randomUUID()}`)
  const progress = createEmptyProgressFixture(1)
  const consolidatedManifest: ConsolidatedManifest = {
    version: 1,
    entries: {
      [consolidatedId]: createConsolidatedManifestEntry({
        consolidatedId,
        domain: 'cross-domain',
        featureName: 'Shared group targeting',
        sourceTestKeys: ['tests/tools/a.test.ts::suite > case'],
        sourceBehaviorIds: ['tests/tools/a.test.ts::suite > case'],
        supportingInternalBehaviorIds: [],
        isUserFacing: true,
        featureKey,
        consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', featureKey),
        evaluatedArtifactPath: null,
        keywords: ['group-targeting', 'shared-feature'],
        sourceDomains: ['commands', 'tools'],
        phase2Fingerprint: 'phase2-fp',
        phase3Fingerprint: null,
        lastConsolidatedAt: '2026-04-20T12:00:00.000Z',
        lastEvaluatedAt: null,
      }),
    },
  }

  await evaluate.runPhase3(
    {
      progress,
      selectedConsolidatedIds: new Set(),
      consolidatedManifest,
    },
    {
      evaluateWithRetry: () =>
        Promise.resolve(
          createEvaluationResult({
            maria: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            dani: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            viktor: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            flaws: [],
            improvements: [],
          }),
        ),
    },
  )

  expect(progress.phase3.stats.consolidatedIdsTotal).toBe(1)
  expect(progress.phase3.stats.consolidatedIdsDone).toBe(1)
  expect((await readEvaluatedArtifact(root, featureKey))[0]?.consolidatedId).toBe(consolidatedId)
})

describe('behavior-audit entrypoint phase3 manifest passthrough', () => {
  test('main passes the consolidated manifest through to phase3 after phase2 completes', async () => {
    const consolidatedManifest = {
      version: 1 as const,
      entries: {
        'tools::selected-case': createConsolidatedManifestEntry({
          consolidatedId: 'tools::selected-case',
          domain: 'tools',
          featureName: 'Selected case',
          sourceTestKeys: ['tests/tools/sample.test.ts::suite > first case'],
          sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > first case'],
          supportingInternalBehaviorIds: [],
          isUserFacing: true,
          featureKey: 'group-targeting' as string | null,
          consolidatedArtifactPath: buildRelativeArtifactPath('consolidated', 'group-targeting'),
          evaluatedArtifactPath: buildRelativeArtifactPath('evaluated', 'group-targeting'),
          keywords: ['group-targeting'] as readonly string[],
          sourceDomains: ['tools'] as readonly string[],
          phase2Fingerprint: 'phase2-fp' as string | null,
          phase3Fingerprint: 'phase3-fp' as string | null,
          lastConsolidatedAt: '2026-04-20T12:00:00.000Z' as string | null,
          lastEvaluatedAt: '2026-04-20T12:30:00.000Z' as string | null,
        }),
      },
    }

    let phase3ManifestArg: ConsolidatedManifest | null = null

    const deps: BehaviorAuditDeps = {
      requireOpenAiApiKey: () => {},
      prepareIncrementalRun: () =>
        Promise.resolve({
          previousManifest: createIncrementalManifestFixture({
            phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
            tests: {},
          }),
          previousLastStartCommit: null,
          updatedManifest: createIncrementalManifestFixture({
            phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
            tests: {},
          }),
        }),
      selectIncrementalRunWork: () =>
        Promise.resolve({
          parsedFiles: [],
          previousConsolidatedManifest: null,
          selection: {
            phase1SelectedTestKeys: [],
            phase2aSelectedTestKeys: [],
            phase2bSelectedFeatureKeys: ['group-targeting'],
            phase3SelectedConsolidatedIds: [],
            reportRebuildOnly: false,
          } satisfies IncrementalSelection,
        }),
      loadOrCreateProgress: () => Promise.resolve(createEmptyProgressFixture(0)),
      rebuildReportsFromStoredResults: () => Promise.resolve(),
      runPhase1IfNeeded: () => Promise.resolve(),
      runPhase2aIfNeeded: () => Promise.resolve(new Set(['group-targeting'])),
      runPhase2bIfNeeded: () => Promise.resolve(consolidatedManifest),
      saveConsolidatedManifest: () => Promise.resolve(),
      runPhase3IfNeeded: (_progress, _selectedConsolidatedIds, _selectedFeatureKeys, manifest) => {
        phase3ManifestArg = manifest
        return Promise.resolve()
      },
      log: { log: mock(() => {}) },
    }

    await runBehaviorAudit(deps)

    expect(phase3ManifestArg).not.toBeNull()
    expect(phase3ManifestArg).toMatchObject(consolidatedManifest)
  })
})

test('writeReports aggregates story output from canonical feature-key maps', async () => {
  const root = makeTempDir()

  mockAuditBehaviorConfig(root, {
    EXCLUDED_PREFIXES: [] as const,
  })

  await writeReports({
    consolidatedManifest: {
      version: 1,
      entries: {},
    },
    consolidatedByFeatureKey: new Map([
      [
        'task-creation',
        [
          {
            id: 'task-creation::feature',
            domain: 'tools',
            featureName: 'Task creation',
            isUserFacing: true,
            behavior: 'Creates a task from chat.',
            userStory: 'As a user, I can create a task.',
            context: 'Task creation context.',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > create task'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > create task'],
            supportingInternalRefs: [],
          },
        ],
      ],
    ]),
    evaluatedByFeatureKey: new Map([
      [
        'task-creation',
        [
          {
            consolidatedId: 'task-creation::feature',
            maria: { discover: 4, use: 4, retain: 4, notes: 'clear' },
            dani: { discover: 3, use: 4, retain: 3, notes: 'usable' },
            viktor: { discover: 2, use: 3, retain: 2, notes: 'needs polish' },
            flaws: ['Missing shortcut'],
            improvements: ['Add shortcut'],
            evaluatedAt: '2026-04-23T12:00:00.000Z',
          },
        ],
      ],
    ]),
    progress: {
      ...createEmptyProgressFixture(0),
      phase3: {
        ...createEmptyProgressFixture(0).phase3,
        status: 'done',
        stats: { consolidatedIdsTotal: 1, consolidatedIdsDone: 1, consolidatedIdsFailed: 0 },
      },
    },
  })

  const storyMarkdown = await Bun.file(path.join(root, 'reports', 'audit-behavior', 'stories', 'tools.md')).text()
  const indexMarkdown = await Bun.file(path.join(root, 'reports', 'audit-behavior', 'stories', 'index.md')).text()

  expect(storyMarkdown).toContain('As a user, I can create a task.')
  expect(storyMarkdown).toContain('Missing shortcut')
  expect(indexMarkdown).toContain('Add shortcut')
})
