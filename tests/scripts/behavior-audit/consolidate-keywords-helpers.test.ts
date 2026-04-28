import { describe, expect, test } from 'bun:test'

import {
  averageLinkageSimilarity,
  buildClusters,
  buildConsolidatedVocabulary,
  buildMergeMap,
  buildUnionFind,
  completeLinkageSimilarity,
  cosineSimilarity,
  electCanonical,
  find,
  remapKeywords,
  union,
} from '../../../scripts/behavior-audit/consolidate-keywords-helpers.js'
import type { KeywordVocabularyEntry } from '../../../scripts/behavior-audit/keyword-vocabulary.js'

// ── cosineSimilarity ──────────────────────────────────────────────────────────

test('cosineSimilarity of identical vectors is 1', () => {
  expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
})

test('cosineSimilarity of orthogonal vectors is 0', () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
})

test('cosineSimilarity of known angle', () => {
  const s = 1 / Math.sqrt(2)
  expect(cosineSimilarity([1, 0], [s, s])).toBeCloseTo(s)
})

test('cosineSimilarity with zero vector returns 0', () => {
  expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
})

// ── union-find ────────────────────────────────────────────────────────────────

test('buildUnionFind initialises each element as its own root', () => {
  const uf = buildUnionFind(3)
  expect(find(uf, 0)).toBe(0)
  expect(find(uf, 1)).toBe(1)
  expect(find(uf, 2)).toBe(2)
})

test('union merges two elements into the same component', () => {
  const uf = buildUnionFind(3)
  union(uf, 0, 1)
  expect(find(uf, 0)).toBe(find(uf, 1))
})

test('union is transitive via union-find', () => {
  const uf = buildUnionFind(3)
  union(uf, 0, 1)
  union(uf, 1, 2)
  expect(find(uf, 0)).toBe(find(uf, 2))
})

// ── buildClusters ─────────────────────────────────────────────────────────────

test('buildClusters returns no clusters when all pairs are below threshold', () => {
  const embeddings = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const clusters = buildClusters(embeddings, 0.99, 2)
  expect(clusters).toHaveLength(0)
})

test('buildClusters returns a cluster when similarity meets threshold', () => {
  // a=[1,0], b=[0.9,0.1] — cosine similarity ≈ 0.994
  const a = [1, 0]
  const mag = Math.sqrt(0.9 * 0.9 + 0.1 * 0.1)
  const b = [0.9 / mag, 0.1 / mag]
  const clusters = buildClusters([a, b], 0.99, 2)
  expect(clusters).toHaveLength(1)
  expect(clusters[0]).toHaveLength(2)
})

test('buildClusters handles transitivity: a~b and b~c should merge all three', () => {
  const s = 1 / Math.sqrt(2)
  const a = [1, 0, 0]
  const b = [s, s, 0]
  const c = [0, 1, 0]
  // cos(a,b) ≈ 0.707, cos(b,c) ≈ 0.707, cos(a,c) = 0
  const clusters = buildClusters([a, b, c], 0.5, 2)
  expect(clusters).toHaveLength(1)
  expect(clusters[0]).toHaveLength(3)
})

test('buildClusters respects minClusterSize', () => {
  // a=[1,0], b=[0.9,0.1] would form a cluster but minClusterSize=3
  const a = [1, 0]
  const mag = Math.sqrt(0.9 * 0.9 + 0.1 * 0.1)
  const b = [0.9 / mag, 0.1 / mag]
  const clusters = buildClusters([a, b], 0.99, 3)
  expect(clusters).toHaveLength(0)
})

describe('averageLinkageSimilarity', () => {
  test('returns 1 for identical singleton clusters', () => {
    const embs = [new Float64Array([1, 0, 0])]
    const result = averageLinkageSimilarity(embs, [0], [0])
    expect(result).toBeCloseTo(1)
  })

  test('returns correct average for known vectors', () => {
    const s = 1 / Math.sqrt(2)
    const embs = [new Float64Array([1, 0]), new Float64Array([s, s]), new Float64Array([0, 1])]
    const result = averageLinkageSimilarity(embs, [0, 1], [2])
    expect(result).toBeCloseTo(s / 2)
  })

  test('returns 0 for orthogonal clusters', () => {
    const embs = [new Float64Array([1, 0, 0]), new Float64Array([0, 1, 0])]
    const result = averageLinkageSimilarity(embs, [0], [1])
    expect(result).toBeCloseTo(0)
  })
})

describe('completeLinkageSimilarity', () => {
  test('returns 1 for identical singleton clusters', () => {
    const embs = [new Float64Array([1, 0, 0])]
    const result = completeLinkageSimilarity(embs, [0], [0])
    expect(result).toBeCloseTo(1)
  })

  test('returns minimum pairwise similarity', () => {
    const s = 1 / Math.sqrt(2)
    const embs = [new Float64Array([1, 0]), new Float64Array([s, s]), new Float64Array([0, 1])]
    const result = completeLinkageSimilarity(embs, [0, 1], [2])
    expect(result).toBeCloseTo(0)
  })

  test('returns max when all pairs have same similarity', () => {
    const embs = [new Float64Array([1, 0]), new Float64Array([1, 0])]
    const result = completeLinkageSimilarity(embs, [0], [1])
    expect(result).toBeCloseTo(1)
  })
})

// ── electCanonical ────────────────────────────────────────────────────────────

function makeEntry(slug: string, createdAt = '2026-01-01T00:00:00.000Z'): KeywordVocabularyEntry {
  return { slug, description: 'desc', createdAt, updatedAt: '2026-01-01T00:00:00.000Z' }
}

test('electCanonical selects the shorter slug', () => {
  const entries = [makeEntry('long-slug-name'), makeEntry('short')]
  const canonical = electCanonical(entries)
  expect(canonical.slug).toBe('short')
})

test('electCanonical breaks slug length tie by earliest createdAt', () => {
  const entries = [makeEntry('aaa', '2026-02-01T00:00:00.000Z'), makeEntry('bbb', '2026-01-01T00:00:00.000Z')]
  const canonical = electCanonical(entries)
  expect(canonical.slug).toBe('bbb')
})

// ── buildMergeMap ─────────────────────────────────────────────────────────────

test('buildMergeMap maps non-canonical slugs to canonical slug', () => {
  const vocab = [makeEntry('short'), makeEntry('longer-version'), makeEntry('also-longer')]
  // cluster: indices [0, 1, 2] — 'short' is canonical
  const clusters = [[0, 1, 2]]
  const mergeMap = buildMergeMap(vocab, clusters)
  expect(mergeMap.get('longer-version')).toBe('short')
  expect(mergeMap.get('also-longer')).toBe('short')
  // canonical not in map
  expect(mergeMap.has('short')).toBe(false)
})

test('buildMergeMap does not include unclustered entries', () => {
  const vocab = [makeEntry('solo'), makeEntry('a'), makeEntry('b')]
  // indices 1 and 2 are clustered; 0 is solo
  const clusters = [[1, 2]]
  const mergeMap = buildMergeMap(vocab, clusters)
  expect(mergeMap.has('solo')).toBe(false)
  expect(mergeMap.size).toBe(1)
})

// ── remapKeywords ─────────────────────────────────────────────────────────────

test('remapKeywords replaces keywords that appear in mergeMap', () => {
  const mergeMap = new Map([['old-slug', 'new-slug']])
  const result = remapKeywords(['old-slug', 'other'], mergeMap)
  expect(result).toEqual(['new-slug', 'other'])
})

test('remapKeywords deduplicates after remapping', () => {
  const mergeMap = new Map([
    ['alias', 'canonical'],
    ['alias2', 'canonical'],
  ])
  const result = remapKeywords(['alias', 'alias2', 'unrelated'], mergeMap)
  expect(result).toEqual(['canonical', 'unrelated'])
})

test('remapKeywords preserves order (first occurrence wins after dedup)', () => {
  const mergeMap = new Map([['b', 'a']])
  const result = remapKeywords(['a', 'b', 'c'], mergeMap)
  // 'b'→'a' deduped since 'a' already present
  expect(result).toEqual(['a', 'c'])
})

test('remapKeywords leaves unaffected keywords unchanged', () => {
  const mergeMap = new Map<string, string>()
  const result = remapKeywords(['one', 'two', 'three'], mergeMap)
  expect(result).toEqual(['one', 'two', 'three'])
})

// ── buildConsolidatedVocabulary ───────────────────────────────────────────────

test('buildConsolidatedVocabulary removes merged slugs and keeps canonicals', () => {
  const vocab = [
    {
      slug: 'short',
      description: 'short desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      slug: 'long-variant',
      description: 'a longer description for the variant',
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    },
  ]
  const mergeMap = new Map([['long-variant', 'short']])
  const now = '2026-04-27T12:00:00.000Z'
  const result = buildConsolidatedVocabulary(vocab, mergeMap, now)

  expect(result).toHaveLength(1)
  const entry = result[0]!
  expect(entry.slug).toBe('short')
  // longest description wins
  expect(entry.description).toBe('a longer description for the variant')
  // earliest createdAt preserved
  expect(entry.createdAt).toBe('2026-01-01T00:00:00.000Z')
  // updatedAt = now (was merged)
  expect(entry.updatedAt).toBe(now)
})

test('buildConsolidatedVocabulary leaves unmerged entries unchanged', () => {
  const vocab = [
    {
      slug: 'standalone',
      description: 'desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]
  const mergeMap = new Map<string, string>()
  const now = '2026-04-27T12:00:00.000Z'
  const result = buildConsolidatedVocabulary(vocab, mergeMap, now)

  expect(result).toHaveLength(1)
  expect(result[0]).toEqual(vocab[0])
})

test('buildConsolidatedVocabulary returns entries sorted by slug', () => {
  const vocab = [
    { slug: 'zebra', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { slug: 'alpha', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]
  const result = buildConsolidatedVocabulary(vocab, new Map(), '2026-04-27T00:00:00.000Z')
  expect(result[0]!.slug).toBe('alpha')
  expect(result[1]!.slug).toBe('zebra')
})
