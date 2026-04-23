import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

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
            behavior: 'When a user targets a group, the bot routes the request correctly.',
            context: 'Routes through group context selection.',
            candidateKeywords: ['group-targeting'],
          }),
        resolveKeywordsWithRetry: () =>
          Promise.resolve({
            keywords: ['group-targeting'],
            appendedEntries: [
              {
                slug: 'group-targeting',
                description: 'Targeting work at a group context.',
                createdAt: '2026-04-20T12:00:00.000Z',
                updatedAt: '2026-04-20T12:00:00.000Z',
              },
            ],
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
  if (!isObject(persistedProgress) || !('phase1' in persistedProgress) || !isObject(persistedProgress['phase1'])) {
    throw new Error('Expected persisted progress shape')
  }
  const persistedPhase1 = persistedProgress['phase1']
  if (!('completedFiles' in persistedPhase1) || !Array.isArray(persistedPhase1['completedFiles'])) {
    throw new Error('Expected persisted phase1 completedFiles array')
  }
  if (!('completedTests' in persistedPhase1) || !isObject(persistedPhase1['completedTests'])) {
    throw new Error('Expected persisted phase1 completedTests record')
  }
  expect(persistedPhase1['completedFiles']).toEqual([])
  expect(persistedPhase1['completedTests']['tests/tools/sample.test.ts']).toBeUndefined()
})
