import { describe, expect, mock, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

type RecordedSubdivideCall = {
  readonly maxClusterSize: number
  readonly linkage: string
  readonly thresholdStep: number
  readonly gapThreshold: number
}

type MockVocabularyEntry = {
  readonly slug: string
}

type TuneEmbeddingModule = {
  readonly runTuneEmbedding: (args: readonly string[]) => Promise<void>
}

function isTuneEmbeddingModule(value: unknown): value is TuneEmbeddingModule {
  return typeof value === 'object' && value !== null && 'runTuneEmbedding' in value
}

async function loadTuneEmbeddingModule(tag: string): Promise<TuneEmbeddingModule> {
  const mod: unknown = await import(`../../../scripts/behavior-audit/tune-embedding.js?test=${tag}`)
  if (!isTuneEmbeddingModule(mod)) {
    throw new Error('Unexpected tune-embedding module shape')
  }
  return mod
}

async function makeExtractedDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tune-embedding-test-'))
  await mkdir(path.join(dir, 'nested'), { recursive: true })
  await writeFile(path.join(dir, 'nested', 'records.json'), JSON.stringify([{ keywords: ['Alpha', 'Beta'] }]), 'utf-8')
  return dir
}

describe('tune-embedding wiring', () => {
  test('forwards gapThreshold into subdivideOversizedClusters', async () => {
    const extractedDir = await makeExtractedDir()
    const recordedCalls: RecordedSubdivideCall[] = []

    void mock.module('../../../scripts/behavior-audit/config.js', () => ({
      EXTRACTED_DIR: extractedDir,
      EMBEDDING_MODEL: 'test-embedding-model',
      reloadBehaviorAuditConfig: (): void => {},
    }))

    void mock.module('../../../scripts/behavior-audit/consolidate-keywords-agent.js', () => ({
      embedSlugBatch: (): Promise<readonly number[][]> => Promise.resolve([]),
    }))

    void mock.module('../../../scripts/behavior-audit/embedding-cache.js', () => ({
      getOrEmbed: (): Promise<{ readonly normalized: readonly (readonly number[])[] }> =>
        Promise.resolve({
          normalized: [
            [1, 0],
            [0, 1],
          ],
        }),
    }))

    void mock.module('../../../scripts/behavior-audit/keyword-vocabulary.js', () => ({
      normalizeKeywordSlug: (keyword: string): string => keyword.toLowerCase(),
    }))

    void mock.module('../../../scripts/behavior-audit/consolidate-keywords-helpers.js', () => ({
      buildClustersAdvanced: (): readonly (readonly number[])[] => [[0, 1]],
      buildMergeMap: (): ReadonlyMap<string, string> => new Map<string, string>(),
      buildConsolidatedVocabulary: (vocabulary: readonly MockVocabularyEntry[]): readonly MockVocabularyEntry[] =>
        vocabulary,
      toNormalizedFloat64Arrays: (vectors: readonly (readonly number[])[]): readonly Float64Array[] =>
        vectors.map((vector) => new Float64Array(vector)),
      subdivideOversizedClusters: (
        _normalized: readonly Float64Array[],
        clusters: readonly (readonly number[])[],
        maxClusterSize: number,
        linkage: string,
        thresholdStep: number,
        gapThreshold: number,
      ): readonly (readonly number[])[] => {
        recordedCalls.push({ maxClusterSize, linkage, thresholdStep, gapThreshold })
        return clusters
      },
    }))

    const tuneEmbedding = await loadTuneEmbeddingModule(crypto.randomUUID())

    await tuneEmbedding.runTuneEmbedding([
      '--max-cluster-size',
      '2',
      '--gap-threshold',
      '0.17',
      '--linkage',
      'complete',
    ])

    expect(recordedCalls).toEqual([
      {
        maxClusterSize: 2,
        linkage: 'complete',
        thresholdStep: 0.01,
        gapThreshold: 0.17,
      },
    ])
  })
})
