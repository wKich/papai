import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { INCREMENTAL_MANIFEST_PATH } from './config.js'

export interface ManifestTestEntry {
  readonly testFile: string
  readonly testName: string
  readonly dependencyPaths: readonly string[]
  readonly phase1Fingerprint: string | null
  readonly phase2Fingerprint: string | null
  readonly extractedBehaviorPath: string | null
  readonly domain: string
  readonly lastPhase1CompletedAt: string | null
  readonly lastPhase2CompletedAt: string | null
}

export interface IncrementalManifest {
  readonly version: 1
  readonly lastStartCommit: string | null
  readonly lastStartedAt: string | null
  readonly lastCompletedAt: string | null
  readonly phaseVersions: {
    readonly phase1: string
    readonly phase2: string
    readonly reports: string
  }
  readonly tests: Record<string, ManifestTestEntry>
}

const ManifestTestEntrySchema = z.object({
  testFile: z.string(),
  testName: z.string(),
  dependencyPaths: z.array(z.string()),
  phase1Fingerprint: z.string().nullable(),
  phase2Fingerprint: z.string().nullable(),
  extractedBehaviorPath: z.string().nullable(),
  domain: z.string(),
  lastPhase1CompletedAt: z.string().nullable(),
  lastPhase2CompletedAt: z.string().nullable(),
})

const IncrementalManifestSchema = z.object({
  version: z.literal(1),
  lastStartCommit: z.string().nullable().default(null),
  lastStartedAt: z.string().nullable().default(null),
  lastCompletedAt: z.string().nullable().default(null),
  phaseVersions: z
    .object({
      phase1: z.string().default(''),
      phase2: z.string().default(''),
      reports: z.string().default(''),
    })
    .default({ phase1: '', phase2: '', reports: '' }),
  tests: z.record(z.string(), ManifestTestEntrySchema).default({}),
})

export function createEmptyManifest(): IncrementalManifest {
  return {
    version: 1,
    lastStartCommit: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    phaseVersions: { phase1: '', phase2: '', reports: '' },
    tests: {},
  }
}

export function captureRunStart(
  manifest: IncrementalManifest,
  currentHead: string,
  startedAt: string,
): {
  readonly previousLastStartCommit: string | null
  readonly updatedManifest: IncrementalManifest
} {
  return {
    previousLastStartCommit: manifest.lastStartCommit,
    updatedManifest: {
      ...manifest,
      lastStartCommit: currentHead,
      lastStartedAt: startedAt,
    },
  }
}

export async function loadManifest(): Promise<IncrementalManifest | null> {
  try {
    const text = await Bun.file(INCREMENTAL_MANIFEST_PATH).text()
    return IncrementalManifestSchema.parse(JSON.parse(text))
  } catch {
    return null
  }
}

export async function saveManifest(manifest: IncrementalManifest): Promise<void> {
  const parsedManifest = IncrementalManifestSchema.parse(manifest)
  await mkdir(dirname(INCREMENTAL_MANIFEST_PATH), { recursive: true })
  await Bun.write(INCREMENTAL_MANIFEST_PATH, JSON.stringify(parsedManifest, null, 2) + '\n')
}
