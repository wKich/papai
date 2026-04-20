import { mkdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import { KEYWORD_VOCABULARY_PATH } from './config.js'

const KeywordVocabularyEntrySchema = z.object({
  slug: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  timesUsed: z.number(),
})

const KeywordVocabularySchema = z.array(KeywordVocabularyEntrySchema)

export type KeywordVocabularyEntry = z.infer<typeof KeywordVocabularyEntrySchema>

export async function loadKeywordVocabulary(): Promise<readonly KeywordVocabularyEntry[] | null> {
  const file = Bun.file(KEYWORD_VOCABULARY_PATH)
  if (!(await file.exists())) return null
  const text = await file.text()
  return KeywordVocabularySchema.parse(JSON.parse(text))
}

export async function saveKeywordVocabulary(entries: readonly KeywordVocabularyEntry[]): Promise<void> {
  const parsed = KeywordVocabularySchema.parse(entries)
  const dir = dirname(KEYWORD_VOCABULARY_PATH)
  const tempPath = join(dir, `.${basename(KEYWORD_VOCABULARY_PATH)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  await mkdir(dir, { recursive: true })
  await Bun.write(tempPath, JSON.stringify(parsed, null, 2) + '\n')
  await rename(tempPath, KEYWORD_VOCABULARY_PATH)
}

export async function recordKeywordUsage(keywords: readonly string[]): Promise<void> {
  const existing = (await loadKeywordVocabulary()) ?? []
  const keywordSet = new Set(keywords)
  const now = new Date().toISOString()
  const updated = existing.map((entry) =>
    keywordSet.has(entry.slug) ? { ...entry, timesUsed: entry.timesUsed + 1, updatedAt: now } : entry,
  )
  await saveKeywordVocabulary(updated)
}

export function findExactKeyword(
  entries: readonly KeywordVocabularyEntry[],
  slug: string,
): KeywordVocabularyEntry | null {
  return entries.find((entry) => entry.slug === slug) ?? null
}
