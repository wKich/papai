import { mkdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import { INCREMENTAL_MANIFEST_PATH, PROJECT_ROOT } from './config.js'

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

function splitGitPathOutput(output: string): readonly string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

async function runGitLines(args: readonly string[]): Promise<readonly string[]> {
  const proc = Bun.spawn(['git', ...args], {
    cwd: PROJECT_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const errorMessage = stderr.trim()
    throw new Error(errorMessage.length > 0 ? errorMessage : `Git command failed: git ${args.join(' ')}`)
  }
  return splitGitPathOutput(stdout)
}

function runGitNameOnlyDiff(rangeOrFlag: string | null): Promise<readonly string[]> {
  const args = ['diff', '--name-only']
  return runGitLines(rangeOrFlag === null ? args : [...args, rangeOrFlag])
}

function runGitUntrackedFiles(): Promise<readonly string[]> {
  return runGitLines(['ls-files', '--others', '--exclude-standard'])
}

export function combineChangedFileLists(lists: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(lists.flat())].toSorted()
}

export async function collectChangedFiles(previousLastStartCommit: string | null): Promise<readonly string[]> {
  const committed =
    previousLastStartCommit === null ? [] : await runGitNameOnlyDiff(`${previousLastStartCommit}...HEAD`)
  const staged = await runGitNameOnlyDiff('--cached')
  const unstaged = await runGitNameOnlyDiff(null)
  const untracked = await runGitUntrackedFiles()

  return combineChangedFileLists([committed, staged, unstaged, untracked])
}

export async function loadManifest(): Promise<IncrementalManifest | null> {
  const manifestFile = Bun.file(INCREMENTAL_MANIFEST_PATH)
  if (!(await manifestFile.exists())) {
    return null
  }

  const text = await manifestFile.text()
  return IncrementalManifestSchema.parse(JSON.parse(text))
}

export async function saveManifest(manifest: IncrementalManifest): Promise<void> {
  const parsedManifest = IncrementalManifestSchema.parse(manifest)
  const manifestDir = dirname(INCREMENTAL_MANIFEST_PATH)
  const tempManifestPath = join(
    manifestDir,
    `.${basename(INCREMENTAL_MANIFEST_PATH)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )

  await mkdir(manifestDir, { recursive: true })
  await Bun.write(tempManifestPath, JSON.stringify(parsedManifest, null, 2) + '\n')
  await rename(tempManifestPath, INCREMENTAL_MANIFEST_PATH)
}
