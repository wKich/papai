import { afterEach, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import * as _impl from '../../scripts/behavior-audit-phase1-write-failure.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, mockAuditBehaviorConfig } from './behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import { isObject, loadExtractModule, loadIncrementalModule } from './behavior-audit-integration.support.js'

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

test('runPhase1 does not publish manifest or progress completion before extracted artifact write succeeds', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  mockAuditBehaviorConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const realIncrementalModule = await loadIncrementalModule(`phase1-write-fail-incremental-${crypto.randomUUID()}`)

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const extract = await loadExtractModule(`phase1-write-fail-${crypto.randomUUID()}`)

  const progress = createEmptyProgressFixture(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)

  await expect(
    extract.runPhase1(
      {
        testFiles: [parsed],
        progress,
        selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
        manifest: realIncrementalModule.createEmptyManifest(),
      },
      {
        extractWithRetry: () =>
          Promise.resolve({
            result: {
              behavior: 'When a user targets a group, the bot routes the request correctly.',
              context: 'Routes through group context selection.',
              keywords: ['group-targeting'],
            },
            usage: { inputTokens: 100, outputTokens: 50, toolCalls: 0, toolNames: [] },
          }),
        writeValidBehaviorsForFile: () => Promise.reject(new Error('disk full')),
      },
    ),
  ).rejects.toThrow('disk full')

  expect(progress.phase1.completedFiles).toEqual([])
  expect(progress.phase1.status).not.toBe('done')
  expect(await Bun.file(progressPath).exists()).toBe(true)
  expect(await Bun.file(manifestPath).exists()).toBe(false)

  const persistedProgressText = await Bun.file(progressPath).text()
  const persistedProgress = JSON.parse(persistedProgressText) as unknown
  assert(isObject(persistedProgress), 'Expected persisted progress to be an object')
  assert('phase1' in persistedProgress, 'Expected persisted progress to have phase1')
  assert(isObject(persistedProgress['phase1']), 'Expected persisted progress phase1 to be an object')
  const persistedPhase1 = persistedProgress['phase1']
  assert('completedFiles' in persistedPhase1, 'Expected persisted phase1 to have completedFiles')
  assert(Array.isArray(persistedPhase1['completedFiles']), 'Expected persisted phase1 completedFiles to be an array')
  assert('completedTests' in persistedPhase1, 'Expected persisted phase1 to have completedTests')
  assert(isObject(persistedPhase1['completedTests']), 'Expected persisted phase1 completedTests to be an object')
  expect(persistedPhase1['completedFiles']).toEqual([])
  expect(persistedPhase1['completedTests']['tests/tools/sample.test.ts']).toBeUndefined()
})
