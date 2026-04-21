import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { IncrementalSelection } from '../../scripts/behavior-audit/incremental.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import {
  createConsolidatedManifestEntry,
  createEmptyProgressFixture,
  createReportsPaths,
  mockReportsConfig,
} from './behavior-audit-integration.helpers.js'
import {
  cleanupTempDirs,
  initializeGitRepo,
  makeTempDir,
  originalOpenAiApiKey,
  restoreOpenAiApiKey,
} from './behavior-audit-integration.runtime-helpers.js'
import {
  loadBehaviorAuditEntryPoint,
  loadEvaluateModule,
  loadIncrementalModule,
  loadProgressModule,
  type MockEvaluationResult,
  type SelectIncrementalWorkInput,
} from './behavior-audit-integration.support.js'

function createEmptyProgress(filesTotal: number): Progress {
  return createEmptyProgressFixture(filesTotal)
}

beforeEach(() => {
  if (originalOpenAiApiKey === undefined) {
    process.env['OPENAI_API_KEY'] = 'test-openai-api-key'
    return
  }

  process.env['OPENAI_API_KEY'] = originalOpenAiApiKey
})

afterEach(() => {
  restoreOpenAiApiKey()
  cleanupTempDirs()
})

describe('behavior-audit phase 3 incremental selection', () => {
  let root: string
  let reportsDir: string
  let progressPath: string
  let consolidatedDir: string
  let evaluateCalls: number

  beforeEach(async () => {
    root = makeTempDir()
    const paths = createReportsPaths(root)
    reportsDir = paths.reportsDir
    progressPath = paths.progressPath
    consolidatedDir = paths.consolidatedDir
    evaluateCalls = 0

    mkdirSync(consolidatedDir, { recursive: true })
    await Bun.write(
      path.join(consolidatedDir, 'tools.json'),
      JSON.stringify(
        [
          {
            id: 'tools::selected-case',
            domain: 'tools',
            featureName: 'selected case',
            isUserFacing: true,
            behavior: 'When the selected behavior runs, the bot returns fresh results.',
            userStory: 'As a user, I get the selected behavior outcome.',
            context: 'Selected context for phase 3.',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
          },
          {
            id: 'tools::unselected-case',
            domain: 'tools',
            featureName: 'unselected case',
            isUserFacing: true,
            behavior: 'When the unselected behavior runs, the bot keeps prior results.',
            userStory: 'Existing unselected story',
            context: 'Unselected context for phase 3.',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > unselected case'],
          },
        ],
        null,
        2,
      ) + '\n',
    )

    mockReportsConfig(root, {
      PROGRESS_PATH: progressPath,
      CONSOLIDATED_DIR: consolidatedDir,
    })

    const realProgressModule = await loadProgressModule(`real=${crypto.randomUUID()}`)
    void mock.module('../../scripts/behavior-audit/progress.js', () => ({ ...realProgressModule }))
    void mock.module('../../scripts/behavior-audit/evaluate-agent.js', () => ({
      evaluateWithRetry: (): Promise<MockEvaluationResult> => {
        evaluateCalls += 1
        const result: MockEvaluationResult = {
          maria: { discover: 4, use: 4, retain: 4, notes: 'Selected Maria notes' },
          dani: { discover: 3, use: 3, retain: 3, notes: 'Selected Dani notes' },
          viktor: { discover: 5, use: 5, retain: 5, notes: 'Selected Viktor notes' },
          flaws: ['Selected flaw'],
          improvements: ['Selected improvement'],
        }
        return Promise.resolve(result)
      },
    }))
  })

  test('runPhase3 only evaluates selected consolidated ids and preserves stored unselected evaluations', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedKey = 'tools::selected-case'
    const unselectedKey = 'tools::unselected-case'
    const progress = createEmptyProgress(1)

    progress.phase2b.completedCandidateFeatures['tools'] = 'done'
    progress.phase3.evaluations[unselectedKey] = {
      testName: 'suite > unselected case',
      behavior: 'When the unselected behavior runs, the bot keeps prior results.',
      userStory: 'Existing unselected story',
      maria: { discover: 2, use: 2, retain: 2, notes: 'Existing Maria notes' },
      dani: { discover: 2, use: 2, retain: 2, notes: 'Existing Dani notes' },
      viktor: { discover: 2, use: 2, retain: 2, notes: 'Existing Viktor notes' },
      flaws: ['Existing flaw'],
      improvements: ['Existing improvement'],
    }
    progress.phase3.completedBehaviors[unselectedKey] = 'done'

    await evaluate.runPhase3({
      progress,
      selectedConsolidatedIds: new Set([selectedKey]),
      consolidatedManifest: {
        version: 1,
        entries: {
          [selectedKey]: {
            consolidatedId: selectedKey,
            domain: 'tools',
            featureName: 'selected case',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            candidateFeatureKey: null,
            keywords: [],
            sourceDomains: ['tools'],
            phase2Fingerprint: null,
            lastConsolidatedAt: null,
          },
          [unselectedKey]: {
            consolidatedId: unselectedKey,
            domain: 'tools',
            featureName: 'unselected case',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > unselected case'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > unselected case'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            candidateFeatureKey: null,
            keywords: [],
            sourceDomains: ['tools'],
            phase2Fingerprint: null,
            lastConsolidatedAt: null,
          },
        },
      },
    })

    const selectedEvaluation = progress.phase3.evaluations[selectedKey]
    if (selectedEvaluation === undefined) {
      throw new Error('Expected selected evaluation to be stored')
    }
    const unselectedEvaluation = progress.phase3.evaluations[unselectedKey]
    if (unselectedEvaluation === undefined) {
      throw new Error('Expected unselected evaluation to remain stored')
    }
    expect(evaluateCalls).toBe(1)
    expect(progress.phase3.completedBehaviors[selectedKey]).toBe('done')
    expect(selectedEvaluation.userStory).toBe('As a user, I get the selected behavior outcome.')
    expect(unselectedEvaluation.userStory).toBe('Existing unselected story')

    const storyFileText = await Bun.file(path.join(reportsDir, 'stories', 'tools.md')).text()
    expect(storyFileText).toContain('selected case')
    expect(storyFileText).toContain('suite > unselected case')
  })

  test('runPhase3 saves progress after storing a selected evaluation', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const selectedKey = 'tools::selected-case'
    const progress = createEmptyProgress(1)
    progress.phase2b.completedCandidateFeatures['tools'] = 'done'

    await evaluate.runPhase3({
      progress,
      selectedConsolidatedIds: new Set([selectedKey]),
      consolidatedManifest: {
        version: 1,
        entries: {
          [selectedKey]: {
            consolidatedId: selectedKey,
            domain: 'tools',
            featureName: 'selected case',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            candidateFeatureKey: null,
            keywords: [],
            sourceDomains: ['tools'],
            phase2Fingerprint: null,
            lastConsolidatedAt: null,
          },
        },
      },
    })

    const progressText = await Bun.file(progressPath).text()
    expect(progressText).toContain('As a user, I get the selected behavior outcome.')
  })

  test('runPhase3 evaluates newly generated consolidated ids even when selection was based on stale ids', async () => {
    const evaluate = await loadEvaluateModule(crypto.randomUUID())
    const staleSelectedKey = 'tools::old-selected-case'
    const freshSelectedKey = 'tools::fresh-selected-case'
    const progress = createEmptyProgress(1)

    await Bun.write(
      path.join(consolidatedDir, 'tools.json'),
      JSON.stringify(
        [
          {
            id: freshSelectedKey,
            domain: 'tools',
            featureName: 'fresh selected case',
            isUserFacing: true,
            behavior: 'When the fresh behavior runs, the bot returns the regenerated output.',
            userStory: 'As a user, I get the regenerated selected behavior outcome.',
            context: 'Fresh context for phase 3.',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
            supportingInternalRefs: [],
          },
        ],
        null,
        2,
      ) + '\n',
    )

    await evaluate.runPhase3({
      progress,
      selectedConsolidatedIds: new Set([staleSelectedKey]),
      consolidatedManifest: {
        version: 1,
        entries: {
          [freshSelectedKey]: {
            consolidatedId: freshSelectedKey,
            domain: 'tools',
            featureName: 'fresh selected case',
            sourceTestKeys: ['tests/tools/sample.test.ts::suite > selected case'],
            sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > selected case'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            candidateFeatureKey: null,
            keywords: [],
            sourceDomains: ['tools'],
            phase2Fingerprint: null,
            lastConsolidatedAt: null,
          },
        },
      },
    })

    expect(evaluateCalls).toBe(1)
    expect(progress.phase3.completedBehaviors[freshSelectedKey]).toBe('done')
    const freshEvaluation = progress.phase3.evaluations[freshSelectedKey]
    if (freshEvaluation === undefined) {
      throw new Error('Expected fresh evaluation to be stored')
    }
    expect(freshEvaluation.userStory).toBe('As a user, I get the regenerated selected behavior outcome.')
  })
})

test('runPhase3 reads consolidated batches by candidate feature from manifest entries', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  void mock.module('../../scripts/behavior-audit/evaluate-agent.js', () => ({
    evaluateWithRetry: (): Promise<MockEvaluationResult> =>
      Promise.resolve({
        maria: { discover: 4, use: 4, retain: 4, notes: 'clear' },
        dani: { discover: 4, use: 4, retain: 4, notes: 'clear' },
        viktor: { discover: 4, use: 4, retain: 4, notes: 'clear' },
        flaws: [],
        improvements: [],
      }),
  }))

  mkdirSync(path.join(reportsDir, 'consolidated'), { recursive: true })
  await Bun.write(
    path.join(reportsDir, 'consolidated', 'group-targeting.json'),
    JSON.stringify([
      {
        id: 'group-targeting::feature',
        domain: 'cross-domain',
        featureName: 'Shared group targeting',
        isUserFacing: true,
        behavior: 'When a user targets a group, the bot routes the request correctly.',
        userStory: 'As a user, I can target a group.',
        context: 'Routes through group context selection.',
        sourceTestKeys: ['tests/tools/a.test.ts::suite > case'],
        sourceBehaviorIds: ['tests/tools/a.test.ts::suite > case'],
        supportingInternalRefs: [],
      },
    ]),
  )

  const evaluate = await loadEvaluateModule(`phase3-keyword-files-${crypto.randomUUID()}`)
  const progress = createEmptyProgress(1)
  const consolidatedManifest = {
    version: 1 as const,
    entries: {
      'group-targeting::feature': {
        consolidatedId: 'group-targeting::feature',
        domain: 'cross-domain',
        featureName: 'Shared group targeting',
        sourceTestKeys: ['tests/tools/a.test.ts::suite > case'],
        sourceBehaviorIds: ['tests/tools/a.test.ts::suite > case'],
        supportingInternalBehaviorIds: [],
        isUserFacing: true,
        candidateFeatureKey: 'group-targeting',
        keywords: ['group-targeting', 'shared-feature'],
        sourceDomains: ['commands', 'tools'],
        phase2Fingerprint: 'phase2-fp',
        lastConsolidatedAt: '2026-04-20T12:00:00.000Z',
      },
    },
  }

  await evaluate.runPhase3({
    progress,
    selectedConsolidatedIds: new Set(),
    consolidatedManifest,
  })

  expect(progress.phase3.stats.behaviorsTotal).toBe(1)
  expect(progress.phase3.stats.behaviorsDone).toBe(1)
  expect(progress.phase3.evaluations['group-targeting::feature']).toBeDefined()
})

describe('behavior-audit entrypoint phase3 manifest passthrough', () => {
  let root: string
  let reportsDir: string
  let manifestPath: string
  let progressPath: string

  beforeEach(async () => {
    root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    progressPath = path.join(reportsDir, 'progress.json')

    const testsDir = path.join(root, 'tests', 'tools')
    mkdirSync(testsDir, { recursive: true })
    writeFileSync(
      path.join(testsDir, 'sample.test.ts'),
      ["describe('suite', () => {", "  test('first case', () => {})", '})', ''].join('\n'),
    )

    mockReportsConfig(root, {
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
    })

    const realIncrementalModule = await loadIncrementalModule(`passthrough=${crypto.randomUUID()}`)
    const realProgressModule = await loadProgressModule(`passthrough=${crypto.randomUUID()}`)

    void mock.module('../../scripts/behavior-audit/incremental.js', () => ({
      ...realIncrementalModule,
      collectChangedFiles: (): Promise<readonly string[]> => Promise.resolve([]),
      selectIncrementalWork: (input: SelectIncrementalWorkInput): IncrementalSelection => ({
        phase1SelectedTestKeys: [...input.discoveredTestKeys],
        phase2aSelectedTestKeys: [...input.discoveredTestKeys],
        phase2bSelectedCandidateFeatureKeys: ['group-targeting'],
        phase3SelectedConsolidatedIds: [],
        reportRebuildOnly: false,
      }),
    }))
    void mock.module('../../scripts/behavior-audit/progress.js', () => ({ ...realProgressModule }))
    void mock.module('../../scripts/behavior-audit/extract.js', () => ({
      runPhase1: (): Promise<void> => Promise.resolve(),
    }))
  })

  test('main passes the consolidated manifest through to phase3 after phase2 completes', async () => {
    await initializeGitRepo(root)

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
          candidateFeatureKey: 'group-targeting' as string | null,
          keywords: ['group-targeting'] as readonly string[],
          sourceDomains: ['tools'] as readonly string[],
          phase2Fingerprint: 'phase2-fp' as string | null,
          lastConsolidatedAt: '2026-04-20T12:00:00.000Z' as string | null,
        }),
      },
    }

    let phase3ManifestArg: typeof consolidatedManifest | null = null

    void mock.module('../../scripts/behavior-audit/classify.js', () => ({
      runPhase2a: (): Promise<ReadonlySet<string>> => Promise.resolve(new Set(['group-targeting'])),
    }))
    void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
      runPhase2b: (): Promise<typeof consolidatedManifest> => Promise.resolve(consolidatedManifest),
    }))
    void mock.module('../../scripts/behavior-audit/evaluate.js', () => ({
      runPhase3: (input: {
        readonly progress: Progress
        readonly selectedConsolidatedIds: ReadonlySet<string>
        readonly consolidatedManifest: typeof consolidatedManifest
      }): Promise<void> => {
        phase3ManifestArg = input.consolidatedManifest
        return Promise.resolve()
      },
    }))

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    expect(phase3ManifestArg).not.toBeNull()
    expect(phase3ManifestArg).toMatchObject(consolidatedManifest)
  })
})
