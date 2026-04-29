import { mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { formatClusteringProfile } from './clustering-profile.js'
import {
  EMBEDDING_BASE_URL,
  EMBEDDING_CACHE_PATH,
  EMBEDDING_MODEL,
  EXTRACTED_DIR,
  reloadBehaviorAuditConfig,
} from './config.js'
import { embedSlugBatch } from './consolidate-keywords-agent.js'
import { buildClustersAdvanced, toNormalizedFloat64Arrays } from './consolidate-keywords-helpers.js'
import type { LinkageMode } from './consolidate-keywords-helpers.js'
import { getOrEmbed } from './embedding-cache.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import { normalizeKeywordSlug } from './keyword-vocabulary.js'
import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'

type BenchmarkParams = Readonly<{
  threshold: number
  linkage: LinkageMode
  gapThreshold: number
  sizes: readonly number[]
  outputPath: string
}>

const VALID_LINKAGES: readonly LinkageMode[] = ['single', 'average', 'complete']

const defaultParams = (): BenchmarkParams => ({
  threshold: 0.9,
  linkage: 'average',
  gapThreshold: 0,
  sizes: [500, 1000, 2000, 4000, 7697],
  outputPath: 'docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md',
})

function parseFiniteNumber(flag: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Invalid numeric value for ${flag}: ${value}`)
  }
  return parsed
}

function parseLinkage(value: string): LinkageMode {
  if (value === 'single' || value === 'average' || value === 'complete') {
    return value
  }
  throw new TypeError(`Unsupported linkage '${value}'. Expected one of: ${VALID_LINKAGES.join(', ')}`)
}

function parsePositiveIntegerList(flag: string, value: string): readonly number[] {
  return value.split(',').map((raw) => {
    const parsed = Number(raw.trim())
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new TypeError(`Invalid positive integer value for ${flag}: ${raw}`)
    }
    return parsed
  })
}

function parseArgsRecursive(args: readonly string[], index: number, params: BenchmarkParams): BenchmarkParams {
  const flag = args[index]
  const value = args[index + 1]

  if (flag === undefined) {
    return params
  }
  if (flag === '--threshold' && value !== undefined) {
    return parseArgsRecursive(args, index + 2, { ...params, threshold: parseFiniteNumber(flag, value) })
  }
  if (flag === '--linkage' && value !== undefined) {
    return parseArgsRecursive(args, index + 2, { ...params, linkage: parseLinkage(value) })
  }
  if (flag === '--gap-threshold' && value !== undefined) {
    return parseArgsRecursive(args, index + 2, { ...params, gapThreshold: parseFiniteNumber(flag, value) })
  }
  if (flag === '--sizes' && value !== undefined) {
    return parseArgsRecursive(args, index + 2, { ...params, sizes: parsePositiveIntegerList(flag, value) })
  }
  if ((flag === '--output' || flag === '--output-path') && value !== undefined) {
    return parseArgsRecursive(args, index + 2, { ...params, outputPath: value })
  }
  return parseArgsRecursive(args, index + 1, params)
}

function parseArgs(args: readonly string[]): BenchmarkParams {
  return parseArgsRecursive(args, 0, defaultParams())
}

async function collectJsonFiles(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(entry.parentPath, entry.name))
}

async function readAllRecords(files: readonly string[]): Promise<readonly ExtractedBehaviorRecord[]> {
  const recordSets = await Promise.all(
    files.map(async (filePath) => {
      const raw: unknown = JSON.parse(await Bun.file(filePath).text())
      return Array.isArray(raw) ? (raw as readonly ExtractedBehaviorRecord[]) : []
    }),
  )
  return recordSets.flat()
}

async function collectUniqueKeywordSlugs(): Promise<readonly string[]> {
  const files = await collectJsonFiles(EXTRACTED_DIR)
  const records = await readAllRecords(files)
  const keywordSet = new Set<string>()

  for (const record of records) {
    for (const keyword of record.keywords) {
      const slug = normalizeKeywordSlug(keyword)
      if (slug.length > 0) {
        keywordSet.add(slug)
      }
    }
  }

  return [...keywordSet].toSorted((left, right) => left.localeCompare(right))
}

function buildVocabulary(slugs: readonly string[], now: string): readonly KeywordVocabularyEntry[] {
  return slugs.map((slug) => ({
    slug,
    description: slug,
    createdAt: now,
    updatedAt: now,
  }))
}

function buildMarkdownSection(size: number, clusterCount: number, profileText: string): string {
  return [`## Size ${size}`, '', '```text', profileText, `clusters=${clusterCount}`, '```'].join('\n')
}

async function run(): Promise<void> {
  reloadBehaviorAuditConfig()
  const params = parseArgs(process.argv.slice(2))
  const slugs = await collectUniqueKeywordSlugs()
  const now = new Date().toISOString()
  const vocabulary = buildVocabulary(slugs, now)

  const embeddingData = await getOrEmbed(EMBEDDING_CACHE_PATH, EMBEDDING_MODEL, vocabulary, {
    embedSlugBatch,
    providerIdentity: EMBEDDING_BASE_URL,
    log: console,
  })
  const normalizedEmbeddings = toNormalizedFloat64Arrays(embeddingData.normalized)

  const sections = params.sizes.flatMap((size) => {
    if (size > vocabulary.length) {
      return []
    }

    const result = buildClustersAdvanced(
      normalizedEmbeddings.slice(0, size),
      params.threshold,
      2,
      params.linkage,
      params.gapThreshold,
      { profile: true },
    )

    return [buildMarkdownSection(size, result.clusters.length, formatClusteringProfile(result.profile))]
  })

  const markdown = [
    '# Embedding Clustering Profile Results',
    '',
    `threshold=${params.threshold}`,
    `linkage=${params.linkage}`,
    `gapThreshold=${params.gapThreshold}`,
    `datasetSize=${vocabulary.length}`,
    '',
    ...sections,
    '',
  ].join('\n')

  await mkdir(dirname(params.outputPath), { recursive: true })
  await Bun.write(params.outputPath, markdown)
  console.log(`Wrote ${params.outputPath}`)
}

if (import.meta.main) {
  await run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
