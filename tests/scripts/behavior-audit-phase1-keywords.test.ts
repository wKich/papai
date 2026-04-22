import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, mockReportsConfig } from './behavior-audit-integration.helpers.js'
import {
  restoreBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  originalOpenAiApiKey,
  restoreOpenAiApiKey,
} from './behavior-audit-integration.runtime-helpers.js'
import {
  isKeywordVocabulary,
  loadExtractModule,
  loadIncrementalModule,
  loadKeywordVocabularyModule,
  loadReportWriterModule,
} from './behavior-audit-integration.support.js'

type ExtractResult = NonNullable<
  Awaited<ReturnType<(typeof import('../../scripts/behavior-audit/extract-agent.js'))['extractWithRetry']>>
>
type ResolveKeywordsResult = NonNullable<
  Awaited<
    ReturnType<(typeof import('../../scripts/behavior-audit/keyword-resolver-agent.js'))['resolveKeywordsWithRetry']>
  >
>

function createExtractResult(input: {
  readonly behavior: string
  readonly context: string
  readonly candidateKeywords: readonly string[]
}): ExtractResult {
  return {
    behavior: input.behavior,
    context: input.context,
    candidateKeywords: [...input.candidateKeywords],
  }
}

function createResolvedKeywords(input: {
  readonly keywords: readonly string[]
  readonly appendedEntries: readonly {
    readonly slug: string
    readonly description: string
    readonly createdAt: string
    readonly updatedAt: string
    readonly timesUsed: number
  }[]
}): ResolveKeywordsResult {
  return {
    keywords: [...input.keywords],
    appendedEntries: input.appendedEntries.map((entry) => ({ ...entry })),
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

test('runPhase1 stores canonical keywords after extraction and vocabulary resolution', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-keywords-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-keywords-${tag}`)

  const progress = createEmptyProgressFixture(1)
  const manifest = incremental.createEmptyManifest()
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)

  await extract.runPhase1(
    {
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest,
    },
    {
      extractWithRetry: (_prompt, _attempt) =>
        Promise.resolve(
          createExtractResult({
            behavior: 'When a user targets a group, the bot routes the request correctly.',
            context: 'Resolves target context and forwards execution through the group routing path.',
            candidateKeywords: ['group-routing', 'group-targeting', 'request-routing'],
          }),
        ),
      resolveKeywordsWithRetry: (_prompt, _attempt) =>
        Promise.resolve(
          createResolvedKeywords({
            keywords: ['group-targeting', 'group-routing'],
            appendedEntries: [],
          }),
        ),
    },
  )

  const stored = progress.phase1.extractedBehaviors['tests/tools/sample.test.ts::suite > case']
  if (stored === undefined) {
    throw new Error('Expected extracted behavior to be stored')
  }
  expect(stored.keywords).toEqual(['group-targeting', 'group-routing'])
})

test('extract-agent returns behavior, context, and candidateKeywords', async () => {
  const mod: unknown = await import(`../../scripts/behavior-audit/extract-agent.js?test=shape-${crypto.randomUUID()}`)
  expect(typeof mod).toBe('object')
  expect(mod).toHaveProperty('extractWithRetry')
})

test('keyword-resolver-agent returns canonical keywords and appended entries', async () => {
  const mod: unknown = await import(
    `../../scripts/behavior-audit/keyword-resolver-agent.js?test=shape-${crypto.randomUUID()}`
  )
  expect(typeof mod).toBe('object')
  expect(mod).toHaveProperty('resolveKeywordsWithRetry')
})

test('behavior-audit agents enable structured outputs for OpenAI-compatible provider', async () => {
  const agentPaths = [
    'scripts/behavior-audit/extract-agent.ts',
    'scripts/behavior-audit/keyword-resolver-agent.ts',
    'scripts/behavior-audit/consolidate-agent.ts',
    'scripts/behavior-audit/evaluate-agent.ts',
  ] as const

  const sources = await Promise.all(agentPaths.map((filePath) => Bun.file(path.join(process.cwd(), filePath)).text()))

  for (const source of sources) {
    expect(source).toContain('supportsStructuredOutputs: true')
  }
})

test('keyword-vocabulary persists entries and updates usage counts', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  mockReportsConfig(root, {
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const typedVocab = await loadKeywordVocabularyModule(`vocab-${crypto.randomUUID()}`)
  await typedVocab.saveKeywordVocabulary([
    {
      slug: 'group-targeting',
      description: 'Targeting work at a group context.',
      createdAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-20T12:00:00.000Z',
      timesUsed: 1,
    },
  ])

  await typedVocab.recordKeywordUsage(['group-targeting'])

  const saved = await typedVocab.loadKeywordVocabulary()
  expect(saved).not.toBeNull()
  if (saved === null) {
    throw new Error('Expected saved vocabulary entries')
  }
  const firstSavedEntry = saved[0]
  if (firstSavedEntry === undefined) {
    throw new Error('Expected first saved vocabulary entry')
  }
  expect(firstSavedEntry.timesUsed).toBe(2)
})

test('writeBehaviorFile renders canonical keywords for each extracted behavior', async () => {
  const root = makeTempDir()

  mockReportsConfig(root, {
    EXCLUDED_PREFIXES: [] as const,
  })

  const typedWriter = await loadReportWriterModule(`keywords-${crypto.randomUUID()}`)
  await typedWriter.writeBehaviorFile('tests/tools/sample.test.ts', [
    {
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When a user targets a group, the bot routes the request correctly.',
      context: 'Routes through group context selection.',
      keywords: ['group-targeting', 'group-routing'],
    },
  ])

  const fileText = await Bun.file(path.join(root, 'reports', 'behaviors', 'tools', 'sample.test.behaviors.md')).text()
  expect(fileText).toContain('**Keywords:** group-targeting, group-routing')
})

test('runPhase1 persists vocabulary updates before marking a test done', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-atomic-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-atomic-${tag}`)

  const progress = createEmptyProgressFixture(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)

  await extract.runPhase1(
    {
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest: incremental.createEmptyManifest(),
    },
    {
      extractWithRetry: (_prompt, _attempt) =>
        Promise.resolve(
          createExtractResult({
            behavior: 'When a user targets a group, the bot routes the request correctly.',
            context: 'Routes through group context selection.',
            candidateKeywords: ['group-targeting'],
          }),
        ),
      resolveKeywordsWithRetry: (_prompt, _attempt) =>
        Promise.resolve(
          createResolvedKeywords({
            keywords: ['group-targeting'],
            appendedEntries: [
              {
                slug: 'group-targeting',
                description: 'Targeting work at a group context.',
                createdAt: '2026-04-20T12:00:00.000Z',
                updatedAt: '2026-04-20T12:00:00.000Z',
                timesUsed: 1,
              },
            ],
          }),
        ),
    },
  )

  const savedVocabText = await Bun.file(vocabularyPath).text()
  expect(savedVocabText).toContain('"group-targeting"')
  const completedTests = progress.phase1.completedTests['tests/tools/sample.test.ts']
  if (completedTests === undefined) {
    throw new Error('Expected completed tests entry for sample test file')
  }
  expect(completedTests['tests/tools/sample.test.ts::suite > case']).toBe('done')
})

test('runPhase1 re-extracts selected changed tests even when prior extraction exists', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')
  let extractCalls = 0

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-rerun-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-rerun-${tag}`)

  const progress = createEmptyProgressFixture(1)
  progress.phase1.completedFiles.push('tests/tools/sample.test.ts')
  progress.phase1.completedTests['tests/tools/sample.test.ts'] = {
    'tests/tools/sample.test.ts::suite > case': 'done',
  }
  progress.phase1.extractedBehaviors['tests/tools/sample.test.ts::suite > case'] = {
    testName: 'case',
    fullPath: 'suite > case',
    behavior: 'Stale extracted behavior.',
    context: 'Stale context.',
    keywords: ['stale-keyword'],
  }

  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)
  await extract.runPhase1(
    {
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest: incremental.createEmptyManifest(),
    },
    {
      extractWithRetry: (_prompt, _attempt) => {
        extractCalls += 1
        return Promise.resolve(
          createExtractResult({
            behavior: 'When a user targets a group, the bot refreshes the extracted behavior.',
            context: 'Reprocesses changed test dependencies.',
            candidateKeywords: ['group-targeting-updated'],
          }),
        )
      },
      resolveKeywordsWithRetry: (_prompt, _attempt) =>
        Promise.resolve(
          createResolvedKeywords({
            keywords: ['group-targeting-updated'],
            appendedEntries: [
              {
                slug: 'group-targeting-updated',
                description: 'Updated targeting behavior.',
                createdAt: '2026-04-20T12:00:00.000Z',
                updatedAt: '2026-04-20T12:00:00.000Z',
                timesUsed: 1,
              },
            ],
          }),
        ),
    },
  )

  expect(extractCalls).toBe(1)
  expect(progress.phase1.extractedBehaviors['tests/tools/sample.test.ts::suite > case']).toMatchObject({
    behavior: 'When a user targets a group, the bot refreshes the extracted behavior.',
    keywords: ['group-targeting-updated'],
  })
})

test('runPhase1 keeps first use count at one for newly appended keywords', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  const testFileContent = "describe('suite', () => { test('case', () => {}) })"
  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'tools', 'sample.test.ts'), testFileContent)

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-keyword-count-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-keyword-count-${tag}`)

  const progress = createEmptyProgressFixture(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', testFileContent)
  await extract.runPhase1(
    {
      testFiles: [parsed],
      progress,
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest: incremental.createEmptyManifest(),
    },
    {
      extractWithRetry: (_prompt, _attempt) =>
        Promise.resolve(
          createExtractResult({
            behavior: 'When a user targets a group, the bot routes the request correctly.',
            context: 'Routes through group context selection.',
            candidateKeywords: ['group-targeting'],
          }),
        ),
      resolveKeywordsWithRetry: (_prompt, _attempt) =>
        Promise.resolve(
          createResolvedKeywords({
            keywords: ['group-targeting'],
            appendedEntries: [
              {
                slug: 'group-targeting',
                description: 'Targeting work at a group context.',
                createdAt: '2026-04-20T12:00:00.000Z',
                updatedAt: '2026-04-20T12:00:00.000Z',
                timesUsed: 1,
              },
            ],
          }),
        ),
    },
  )

  const savedVocabularyRaw: unknown = JSON.parse(await Bun.file(vocabularyPath).text())
  if (!isKeywordVocabulary(savedVocabularyRaw)) {
    throw new Error('Expected saved keyword vocabulary')
  }
  const savedVocabulary = savedVocabularyRaw
  expect(savedVocabulary).toHaveLength(1)
  expect(savedVocabulary[0]).toMatchObject({ slug: 'group-targeting', timesUsed: 1 })
})

test('runPhase1 sends only existing vocabulary slugs to the keyword resolver prompt', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')
  let capturedResolverPrompt = ''

  mockReportsConfig(root, {
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    EXCLUDED_PREFIXES: [] as const,
  })

  mkdirSync(path.join(root, 'tests', 'tools'), { recursive: true })
  writeFileSync(
    path.join(root, 'tests', 'tools', 'sample.test.ts'),
    "describe('suite', () => { test('case', () => {}) })",
  )
  await Bun.write(
    vocabularyPath,
    JSON.stringify(
      [
        {
          slug: 'group-targeting',
          description: 'Targeting work at a group context.',
          createdAt: '2026-04-20T12:00:00.000Z',
          updatedAt: '2026-04-20T12:00:00.000Z',
          timesUsed: 3,
        },
        {
          slug: 'group-routing',
          description: 'Routing work inside a group context.',
          createdAt: '2026-04-20T12:00:00.000Z',
          updatedAt: '2026-04-20T12:00:00.000Z',
          timesUsed: 2,
        },
      ],
      null,
      2,
    ) + '\n',
  )

  const tag = crypto.randomUUID()
  const extract = await loadExtractModule(`phase1-slug-prompt-${tag}`)
  const incremental = await loadIncrementalModule(`phase1-slug-prompt-${tag}`)

  await extract.runPhase1(
    {
      testFiles: [parseTestFile('tests/tools/sample.test.ts', "describe('suite', () => { test('case', () => {}) })")],
      progress: createEmptyProgressFixture(1),
      selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
      manifest: incremental.createEmptyManifest(),
    },
    {
      extractWithRetry: (_prompt, _attempt) =>
        Promise.resolve(
          createExtractResult({
            behavior: 'When a user targets a group, the bot routes the request correctly.',
            context: 'Routes through group context selection.',
            candidateKeywords: ['group-targeting'],
          }),
        ),
      resolveKeywordsWithRetry: (prompt, _attempt) => {
        capturedResolverPrompt = prompt
        return Promise.resolve(
          createResolvedKeywords({
            keywords: ['group-targeting'],
            appendedEntries: [],
          }),
        )
      },
    },
  )

  expect(capturedResolverPrompt).toContain('Existing vocabulary:')
  expect(capturedResolverPrompt).toContain('Candidate keywords: group-targeting')
  expect(capturedResolverPrompt).toContain('[\n  "group-targeting",\n  "group-routing"\n]')
  expect(capturedResolverPrompt).not.toContain('"description"')
  expect(capturedResolverPrompt).not.toContain('"timesUsed"')
})
