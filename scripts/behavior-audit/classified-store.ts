import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { CLASSIFIED_DIR } from './config.js'

export interface ClassifiedBehavior {
  readonly behaviorId: string
  readonly testKey: string
  readonly domain: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly visibility: 'user-facing' | 'internal' | 'ambiguous'
  readonly candidateFeatureKey: string | null
  readonly candidateFeatureLabel: string | null
  readonly supportingBehaviorRefs: readonly { readonly behaviorId: string; readonly reason: string }[]
  readonly relatedBehaviorHints: readonly {
    readonly testKey: string
    readonly relation: 'same-feature' | 'supporting-detail' | 'possibly-related'
    readonly reason: string
  }[]
  readonly classificationNotes: string
}

const RelatedBehaviorHintSchema = z.object({
  testKey: z.string(),
  relation: z.enum(['same-feature', 'supporting-detail', 'possibly-related']),
  reason: z.string(),
})

const SupportingBehaviorRefSchema = z.object({
  behaviorId: z.string(),
  reason: z.string(),
})

const ClassifiedBehaviorSchema = z.object({
  behaviorId: z.string(),
  testKey: z.string(),
  domain: z.string(),
  behavior: z.string(),
  context: z.string(),
  keywords: z.array(z.string()).readonly(),
  visibility: z.enum(['user-facing', 'internal', 'ambiguous']),
  candidateFeatureKey: z.string().nullable(),
  candidateFeatureLabel: z.string().nullable(),
  supportingBehaviorRefs: z.array(SupportingBehaviorRefSchema).readonly(),
  relatedBehaviorHints: z.array(RelatedBehaviorHintSchema).readonly(),
  classificationNotes: z.string(),
})

const ClassifiedBehaviorArraySchema = z.array(ClassifiedBehaviorSchema).readonly()

export async function writeClassifiedFile(domain: string, behaviors: readonly ClassifiedBehavior[]): Promise<void> {
  const outPath = join(CLASSIFIED_DIR, `${domain}.json`)
  await mkdir(dirname(outPath), { recursive: true })
  const sorted = [...behaviors].toSorted((a, b) => a.behaviorId.localeCompare(b.behaviorId))
  await Bun.write(outPath, JSON.stringify(sorted, null, 2) + '\n')
}

export async function readClassifiedFile(domain: string): Promise<readonly ClassifiedBehavior[] | null> {
  const filePath = join(CLASSIFIED_DIR, `${domain}.json`)
  try {
    const raw: unknown = JSON.parse(await Bun.file(filePath).text())
    return ClassifiedBehaviorArraySchema.parse(raw)
  } catch {
    return null
  }
}
