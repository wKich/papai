import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { reloadBehaviorAuditConfig, EXTRACTED_DIR, EMBEDDING_MODEL } from './config.js'
import { getOrEmbed } from './embedding-cache.js'
import { embedSlugBatch } from './consolidate-keywords-agent.js'
import { buildClustersNormalized, buildConsolidatedVocabulary, buildMergeMap, toNormalizedFloat64Arrays } from './consolidate-keywords-helpers.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import { normalizeKeywordSlug } from './keyword-vocabulary.js'
import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'

interface TuneParams {
  readonly threshold: number
  readonly minClusterSize: number
  readonly reembed: boolean
  readonly cacheDir: string
}

interface TuneResult {
  readonly initialCount: number
  readonly finalCount: number
  readonly merges: number
  readonly initialKeywords: readonly string[]
  readonly finalKeywords: readonly string[]
  readonly mergePairs: ReadonlyArray<readonly [string, string]>
}

function parseArgs(args: readonly string[]): TuneParams {
  let threshold = 0.92
  let minClusterSize = 2
  let reembed = false
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    const value = args[i + 1]
    if (flag === '--threshold' && value !== undefined) {
      threshold = Number(value)
      i++
    }
    if (flag === '--min-cluster-size' && value !== undefined) {
      minClusterSize = Number(value)
      i++
    }
    if (flag === '--re-embed') {
      reembed = true
    }
  }
  const cacheDir = join(tmpdir(), 'tune-embed-cache')
  return { threshold, minClusterSize, reembed, cacheDir }
}

async function collectJsonFiles(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => join(e.parentPath, e.name))
}

async function readAllRecords(files: readonly string[]): Promise<readonly ExtractedBehaviorRecord[]> {
  const parsed = await Promise.all(
    files.map(async (filePath) => {
      const raw: unknown = JSON.parse(await Bun.file(filePath).text())
      return Array.isArray(raw) ? (raw as readonly ExtractedBehaviorRecord[]) : []
    }),
  )
  return parsed.flat()
}

async function collectUniqueKeywords(): Promise<readonly string[]> {
  let files: readonly string[]
  try {
    files = await collectJsonFiles(EXTRACTED_DIR)
  } catch {
    return []
  }

  const records = await readAllRecords(files)
  const keywordSet = new Set<string>()
  for (const record of records) {
    if (!Array.isArray(record.keywords)) continue
    for (const kw of record.keywords) {
      if (typeof kw !== 'string') continue
      const slug = normalizeKeywordSlug(kw)
      if (slug.length > 0) {
        keywordSet.add(slug)
      }
    }
  }
  return [...keywordSet].toSorted()
}

function toVocabulary(keywords: readonly string[], now: string): readonly KeywordVocabularyEntry[] {
  return keywords.map((slug) => ({ slug, description: slug, createdAt: now, updatedAt: now }))
}

function extractMergePairs(mergeMap: ReadonlyMap<string, string>): readonly (readonly [string, string])[] {
  return [...mergeMap.entries()]
}

async function writeTempKeywordList(prefix: string, keywords: readonly string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tune-embed-'))
  const path = join(dir, `${prefix}-keywords.txt`)
  await writeFile(path, keywords.join('\n') + '\n', 'utf-8')
  return path
}

async function runTune(params: TuneParams): Promise<TuneResult> {
  reloadBehaviorAuditConfig()

  const initialKeywords = await collectUniqueKeywords()
  const initialCount = initialKeywords.length
  if (initialCount === 0) {
    return {
      initialCount: 0,
      finalCount: 0,
      merges: 0,
      initialKeywords: [],
      finalKeywords: [],
      mergePairs: [],
    }
  }

  const now = new Date().toISOString()
  const vocabulary = toVocabulary(initialKeywords, now)
  const cachePath = join(params.cacheDir, 'embedding-cache.json')

  const embeddingData = await getOrEmbed(
    cachePath,
    EMBEDDING_MODEL,
    vocabulary,
    { embedSlugBatch, log: console },
    params.reembed,
  )

  const normalized = toNormalizedFloat64Arrays(embeddingData.normalized)
  console.log(`[tune] Clustering at threshold=${params.threshold}, minClusterSize=${params.minClusterSize}...`)
  const clusters = buildClustersNormalized(normalized, params.threshold, params.minClusterSize)
  const mergeMap = buildMergeMap(vocabulary, clusters)

  const consolidated = buildConsolidatedVocabulary(vocabulary, mergeMap, now)
  const finalKeywords = consolidated.map((e) => e.slug)
  const finalCount = finalKeywords.length
  const mergePairs = extractMergePairs(mergeMap)

  return { initialCount, finalCount, merges: mergeMap.size, initialKeywords, finalKeywords, mergePairs }
}

function printSummary(result: TuneResult, params: TuneParams): void {
  console.log('')
  console.log('=== Embedding Tuning Summary ===')
  console.log(`  threshold:       ${params.threshold}`)
  console.log(`  minClusterSize:  ${params.minClusterSize}`)
  console.log(`  initial slugs:   ${result.initialCount}`)
  console.log(`  final slugs:     ${result.finalCount}`)
  console.log(`  merges applied:  ${result.merges}`)
  console.log(
    `  reduction:       ${result.initialCount > 0 ? ((1 - result.finalCount / result.initialCount) * 100).toFixed(1) : 0}%`,
  )
  console.log(`  re-embedded:     ${params.reembed}`)
  console.log(`  cache dir:       ${params.cacheDir}`)
  if (result.mergePairs.length > 0) {
    console.log('')
    console.log('  Merge map:')
    for (const [from, to] of result.mergePairs) {
      console.log(`    ${from.padEnd(30)} -> ${to}`)
    }
  }
}

async function writeTempFiles(result: TuneResult): Promise<void> {
  const initialPath = await writeTempKeywordList('initial', result.initialKeywords)
  const finalPath = await writeTempKeywordList('final', result.finalKeywords)
  console.log('')
  console.log(`  initial keywords: ${initialPath}`)
  console.log(`  final keywords:   ${finalPath}`)
}

export async function runTuneEmbedding(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const params = parseArgs(args)
  const result = await runTune(params)
  printSummary(result, params)
  if (result.initialCount > 0) {
    await writeTempFiles(result)
  }
  console.log('')
}

if (import.meta.main) {
  await runTuneEmbedding().catch((error: unknown) => {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
