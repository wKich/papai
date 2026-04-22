import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import type { IncrementalManifest } from '../../scripts/behavior-audit/incremental.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import {
  createEmptyProgressFixture,
  createManifestTestEntry,
  mockReportsConfig,
  writeWorkspaceFile,
} from './behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir } from './behavior-audit-integration.runtime-helpers.js'
import {
  createEmptyManifest,
  getManifestEntry,
  loadExtractModule,
  readSavedManifest,
} from './behavior-audit-integration.support.js'

function createEmptyProgress(filesTotal: number): Progress {
  return createEmptyProgressFixture(filesTotal)
}

afterEach(() => {
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

    mockReportsConfig(root, {
      PROGRESS_PATH: progressPath,
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
      PHASE2_TIMEOUT_MS: 600_000,
    })
  })

  test('runPhase1 only processes selected test keys and writes manifest updates after successful extraction', async () => {
    const extract = await loadExtractModule(crypto.randomUUID())
    const testFilePath = 'tests/tools/sample.test.ts'
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
          extractedBehaviorPath: 'reports/behaviors/tools/sample.test.behaviors.md',
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
            behavior: 'When the injected test extractor runs, the bot persists the injected behavior.',
            context: 'Uses the injected phase 1 extractor dependency.',
            candidateKeywords: ['injected-extraction'],
          }),
        resolveKeywordsWithRetry: () =>
          Promise.resolve({
            keywords: ['injected-extraction'],
            appendedEntries: [],
          }),
      },
    )

    expect(Object.keys(progress.phase1.extractedBehaviors)).toEqual([selectedKey])
    expect(progress.phase1.completedTests[testFilePath]).toEqual({ [selectedKey]: 'done' })
    expect(progress.phase1.extractedBehaviors[selectedKey]).toMatchObject({
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
    expect(savedEntry.extractedBehaviorPath).toBe('reports/audit-behavior/behaviors/tools/sample.test.behaviors.md')
    expect(savedEntry.lastPhase1CompletedAt).toBeTruthy()
    expect(savedManifest.tests['tests/tools/sample.test.ts::suite > unselected case']).toBeUndefined()

    const behaviorFilePath = path.join(reportsDir, 'behaviors', 'tools', 'sample.test.behaviors.md')
    const behaviorFileText = await Bun.file(behaviorFilePath).text()
    expect(behaviorFileText).toContain('suite > selected case')
    expect(behaviorFileText).toContain('When the injected test extractor runs, the bot persists the injected behavior.')
    expect(behaviorFileText).not.toContain('suite > unselected case')
  })
})
