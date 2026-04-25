import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { createEmptyManifest as barrelCreateEmptyManifest } from '../../scripts/behavior-audit-phase1-selection.js'
import type { IncrementalManifest } from '../../scripts/behavior-audit/incremental.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import {
  createEmptyProgressFixture,
  createManifestTestEntry,
  mockAuditBehaviorConfig,
  writeWorkspaceFile,
} from './behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import {
  createEmptyManifest,
  getManifestEntry,
  loadExtractModule,
  readSavedManifest,
} from './behavior-audit-integration.support.js'

function createEmptyProgress(filesTotal: number): Progress {
  return createEmptyProgressFixture(filesTotal)
}

const ExtractedBehaviorRecordArraySchema = z.array(
  z.strictObject({
    behaviorId: z.string(),
    testKey: z.string(),
    testFile: z.string(),
    domain: z.string(),
    testName: z.string(),
    fullPath: z.string(),
    behavior: z.string(),
    context: z.string(),
    keywords: z.array(z.string()).readonly(),
    extractedAt: z.string(),
  }),
)

function expectExtractedRecord(
  record: z.infer<typeof ExtractedBehaviorRecordArraySchema>[number],
  input: Pick<z.infer<typeof ExtractedBehaviorRecordArraySchema>[number], 'behavior' | 'context' | 'keywords'>,
): void {
  expect(record.behavior).toBe(input.behavior)
  expect(record.context).toBe(input.context)
  expect(record.keywords).toEqual(input.keywords)
}

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

describe('behavior-audit phase 1 incremental selection', () => {
  let root: string
  let reportsDir: string
  let manifestPath: string
  let progressPath: string

  beforeEach(() => {
    root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    progressPath = path.join(reportsDir, 'progress.json')

    const testsDir = path.join(root, 'tests', 'tools')
    const srcDir = path.join(root, 'src', 'tools')
    mkdirSync(testsDir, { recursive: true })
    mkdirSync(srcDir, { recursive: true })
    writeWorkspaceFile(
      root,
      'tests/tools/sample.test.ts',
      [
        "describe('suite', () => {",
        "  test('selected case', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '',
        "  test('unselected case', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    writeWorkspaceFile(root, 'src/tools/sample.ts', 'export const sample = 1\n')

    mockAuditBehaviorConfig(root, {
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
      PHASE2_TIMEOUT_MS: 600_000,
    })
  })

  test('runPhase1 only processes selected test keys and writes manifest updates after successful extraction', async () => {
    expect(barrelCreateEmptyManifest().version).toBe(1)
    const extract = await loadExtractModule(crypto.randomUUID())
    const testFilePath = 'tests/tools/sample.test.ts'
    const extractedArtifactPath = path.join(reportsDir, 'audit-behavior', 'extracted', 'tools', 'sample.test.json')
    const parsedFile = parseTestFile(testFilePath, await Bun.file(path.join(root, testFilePath)).text())
    const selectedKey = 'tests/tools/sample.test.ts::suite > selected case'
    const progress = createEmptyProgress(1)
    const manifest: IncrementalManifest = {
      ...createEmptyManifest(),
      phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
      tests: {
        [selectedKey]: createManifestTestEntry({
          testFile: testFilePath,
          testName: 'suite > selected case',
          dependencyPaths: [testFilePath],
          phase1Fingerprint: 'stale-phase1',
          phase2Fingerprint: 'stale-phase2',
          extractedArtifactPath: 'reports/audit-behavior/extracted/tools/sample.test.json',
          domain: 'tools',
          lastPhase1CompletedAt: null,
          lastPhase2CompletedAt: 'old-phase2',
        }),
      },
    }

    await extract.runPhase1(
      {
        testFiles: [parsedFile],
        progress,
        selectedTestKeys: new Set([selectedKey]),
        manifest,
      },
      {
        extractWithRetry: () =>
          Promise.resolve({
            result: {
              behavior: 'When the injected test extractor runs, the bot persists the injected behavior.',
              context: 'Uses the injected phase 1 extractor dependency.',
              candidateKeywords: ['injected-extraction'],
            },
            usage: { inputTokens: 100, outputTokens: 50, toolCalls: 2, toolNames: ['readFile', 'grep'] },
          }),
        resolveKeywordsWithRetry: () =>
          Promise.resolve({
            result: {
              keywords: ['injected-extraction'],
              appendedEntries: [],
            },
            usage: { inputTokens: 50, outputTokens: 20, toolCalls: 0, toolNames: [] },
          }),
      },
    )

    expect(progress.phase1.completedTests[testFilePath]).toEqual({ [selectedKey]: 'done' })
    expect(progress.phase2a.status).toBe('not-started')
    expect(progress.phase2b.status).toBe('not-started')
    expect(progress.phase3.status).toBe('not-started')

    const extractedRecords = ExtractedBehaviorRecordArraySchema.parse(
      JSON.parse(await Bun.file(extractedArtifactPath).text()),
    )
    expect(extractedRecords).toHaveLength(1)
    const firstRecord = extractedRecords[0]
    if (firstRecord === undefined) {
      throw new Error('Expected first extracted record')
    }
    expect(firstRecord.behaviorId).toBe(selectedKey)
    expect(firstRecord.testKey).toBe(selectedKey)
    expect(firstRecord.testFile).toBe(testFilePath)
    expect(firstRecord.domain).toBe('tools')
    expect(firstRecord.testName).toBe('selected case')
    expect(firstRecord.fullPath).toBe('suite > selected case')
    expect(firstRecord.behavior).toBe('When the injected test extractor runs, the bot persists the injected behavior.')
    expect(firstRecord.context).toBe('Uses the injected phase 1 extractor dependency.')
    expect(firstRecord.keywords).toEqual(['injected-extraction'])
    expect(typeof firstRecord.extractedAt).toBe('string')

    const extractedRecord = extractedRecords[0]
    if (extractedRecord === undefined) {
      throw new Error('Expected extracted record')
    }
    expectExtractedRecord(extractedRecord, {
      behavior: 'When the injected test extractor runs, the bot persists the injected behavior.',
      context: 'Uses the injected phase 1 extractor dependency.',
      keywords: ['injected-extraction'],
    })

    const savedManifest = await readSavedManifest(manifestPath)
    const savedEntry = getManifestEntry(savedManifest, selectedKey)
    expect(savedEntry.phase1Fingerprint).toBeTruthy()
    expect(savedEntry.phase2Fingerprint).toBeTruthy()
    expect(savedEntry.lastPhase2CompletedAt).toBeNull()
    expect(savedEntry.dependencyPaths).toEqual(['tests/tools/sample.test.ts', 'src/tools/sample.ts'])
    expect(savedEntry.domain).toBe('tools')
    expect(savedEntry.extractedArtifactPath).toBe('reports/audit-behavior/extracted/tools/sample.test.json')
    expect(savedEntry.lastPhase1CompletedAt).toBeTruthy()
    expect(savedManifest.tests['tests/tools/sample.test.ts::suite > unselected case']).toBeUndefined()
  })

  test('runPhase1 removes stale extracted artifacts for a failed selected rerun', async () => {
    const extract = await loadExtractModule(crypto.randomUUID())
    const testFilePath = 'tests/tools/sample.test.ts'
    const selectedKey = 'tests/tools/sample.test.ts::suite > selected case'
    const extractedArtifactPath = path.join(reportsDir, 'audit-behavior', 'extracted', 'tools', 'sample.test.json')
    const parsedFile = parseTestFile(testFilePath, await Bun.file(path.join(root, testFilePath)).text())
    const progress = createEmptyProgress(1)

    progress.phase1.completedFiles.push(testFilePath)
    progress.phase1.completedTests[testFilePath] = { [selectedKey]: 'done' }
    progress.phase1.stats.filesDone = 1
    progress.phase1.stats.testsExtracted = 1

    await Bun.write(
      extractedArtifactPath,
      JSON.stringify(
        [
          {
            behaviorId: selectedKey,
            testKey: selectedKey,
            testFile: testFilePath,
            domain: 'tools',
            testName: 'selected case',
            fullPath: 'suite > selected case',
            behavior: 'Stale selected behavior.',
            context: 'Stale selected context.',
            keywords: ['stale-selected'],
            extractedAt: '2026-04-20T12:00:00.000Z',
          },
        ],
        null,
        2,
      ) + '\n',
    )

    await extract.runPhase1(
      {
        testFiles: [parsedFile],
        progress,
        selectedTestKeys: new Set([selectedKey]),
        manifest: createEmptyManifest(),
      },
      {
        extractWithRetry: () => Promise.resolve(null),
      },
    )

    expect(await Bun.file(extractedArtifactPath).exists()).toBe(false)
    expect(progress.phase1.completedFiles).toEqual([])
    expect(progress.phase1.completedTests[testFilePath]).toBeUndefined()
    expect(progress.phase1.stats.filesDone).toBe(0)
    expect(progress.phase1.stats.testsExtracted).toBe(0)
  })

  test('runPhase1 resets downstream phases before the first saved checkpoint when selected work exists', async () => {
    const extract = await loadExtractModule(crypto.randomUUID())
    const testFilePath = 'tests/tools/sample.test.ts'
    const parsedFile = parseTestFile(testFilePath, await Bun.file(path.join(root, testFilePath)).text())
    const selectedKey = 'tests/tools/sample.test.ts::suite > selected case'
    const progress = createEmptyProgress(1)
    const savedSnapshots: Progress[] = []

    progress.phase2a.status = 'done'
    progress.phase2a.completedBehaviors = { stale: 'done' }
    progress.phase2b.status = 'done'
    progress.phase2b.completedFeatureKeys = { stale: 'done' }
    progress.phase3.status = 'done'
    progress.phase3.completedConsolidatedIds = { stale: 'done' }

    await extract.runPhase1(
      {
        testFiles: [parsedFile],
        progress,
        selectedTestKeys: new Set([selectedKey]),
        manifest: createEmptyManifest(),
      },
      {
        extractWithRetry: () =>
          Promise.resolve({
            result: {
              behavior: 'When selected work reruns, downstream checkpoints are invalidated first.',
              context: 'Resets downstream checkpoint state before saving in-progress phase 1 state.',
              candidateKeywords: ['phase1-reset'],
            },
            usage: { inputTokens: 100, outputTokens: 50, toolCalls: 2, toolNames: ['readFile', 'grep'] },
          }),
        resolveKeywordsWithRetry: () =>
          Promise.resolve({
            result: {
              keywords: ['phase1-reset'],
              appendedEntries: [],
            },
            usage: { inputTokens: 50, outputTokens: 20, toolCalls: 0, toolNames: [] },
          }),
        saveProgress: (currentProgress) => {
          savedSnapshots.push(structuredClone(currentProgress))
          return Promise.resolve()
        },
      },
    )

    const firstSnapshot = savedSnapshots[0]
    if (firstSnapshot === undefined) {
      throw new Error('Expected first saved progress snapshot')
    }
    expect(firstSnapshot.phase1.status).toBe('in-progress')
    expect(firstSnapshot.phase2a.status).toBe('not-started')
    expect(firstSnapshot.phase2a.completedBehaviors).toEqual({})
    expect(firstSnapshot.phase2b.status).toBe('not-started')
    expect(firstSnapshot.phase2b.completedFeatureKeys).toEqual({})
    expect(firstSnapshot.phase3.status).toBe('not-started')
    expect(firstSnapshot.phase3.completedConsolidatedIds).toEqual({})
  })
})
