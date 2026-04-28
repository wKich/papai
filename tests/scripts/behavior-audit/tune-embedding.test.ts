import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runTuneEmbedding } from '../../../scripts/behavior-audit/tune-embedding.js'

type RecordedSubdivideCall = {
  readonly maxClusterSize: number
  readonly linkage: string
  readonly thresholdStep: number
  readonly gapThreshold: number
}

type MockVocabularyEntry = {
  readonly slug: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
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

    await runTuneEmbedding(['--max-cluster-size', '2', '--gap-threshold', '0.17', '--linkage', 'complete'], {
      extractedDir,
      embeddingModel: 'test-embedding-model',
      reloadBehaviorAuditConfig: (): void => {},
      embedSlugBatch: (): Promise<readonly number[][]> => Promise.resolve([]),
      getOrEmbed: (): Promise<{
        readonly raw: readonly (readonly number[])[]
        readonly normalized: readonly (readonly number[])[]
      }> =>
        Promise.resolve({
          raw: [
            [1, 0],
            [0, 1],
          ],
          normalized: [
            [1, 0],
            [0, 1],
          ],
        }),
      normalizeKeywordSlug: (keyword: string): string => keyword.toLowerCase(),
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
    })

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
