import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { EXCLUDED_PREFIXES, PROJECT_ROOT } from './behavior-audit/config.js'
import { runPhase2 } from './behavior-audit/consolidate.js'
import { runPhase3 } from './behavior-audit/evaluate.js'
import { runPhase1 } from './behavior-audit/extract.js'
import type { IncrementalManifest } from './behavior-audit/incremental.js'
import {
  captureRunStart,
  collectChangedFiles,
  createEmptyConsolidatedManifest,
  createEmptyManifest,
  loadConsolidatedManifest,
  loadManifest,
  saveConsolidatedManifest,
  saveManifest,
  selectIncrementalWork,
} from './behavior-audit/incremental.js'
import type { Progress } from './behavior-audit/progress.js'
import { createEmptyProgress, loadProgress, saveProgress } from './behavior-audit/progress.js'
import { rebuildReportsFromStoredResults } from './behavior-audit/report-writer.js'
import type { ParsedTestFile } from './behavior-audit/test-parser.js'
import { parseTestFile } from './behavior-audit/test-parser.js'

async function discoverTestFiles(): Promise<string[]> {
  const testDir = join(PROJECT_ROOT, 'tests')
  const files: string[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    const subdirs: string[] = []
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        subdirs.push(fullPath)
      } else if (entry.name.endsWith('.test.ts')) {
        const relPath = relative(PROJECT_ROOT, fullPath)
        const excluded = EXCLUDED_PREFIXES.some((p) => relPath.startsWith(p))
        if (excluded) continue
        files.push(relPath)
      }
    }
    await Promise.all(subdirs.map((d) => walk(d)))
  }

  await walk(testDir)
  return files.toSorted()
}

async function loadOrCreateProgress(testCount: number): Promise<Progress> {
  const loaded = await loadProgress()
  if (loaded === null) {
    const fresh = createEmptyProgress(testCount)
    await saveProgress(fresh)
    return fresh
  }
  return loaded
}

function parseDiscoveredTestFiles(testFilePaths: readonly string[]): Promise<readonly ParsedTestFile[]> {
  return Promise.all(
    testFilePaths.map(async (filePath) => {
      const content = await Bun.file(join(PROJECT_ROOT, filePath)).text()
      return parseTestFile(filePath, content)
    }),
  )
}

function getDiscoveredTestKeys(parsedFiles: readonly ParsedTestFile[]): readonly string[] {
  return parsedFiles
    .flatMap((parsedFile) => parsedFile.tests.map((testCase) => `${parsedFile.filePath}::${testCase.fullPath}`))
    .toSorted()
}

async function runPhase1IfNeeded(
  parsedFiles: readonly ParsedTestFile[],
  progress: Progress,
  selectedTestKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
): Promise<void> {
  if (progress.phase1.status === 'done' && selectedTestKeys.size === 0) {
    console.log('[Phase 1] Already complete, skipping.\n')
    return
  }
  await runPhase1({ testFiles: parsedFiles, progress, selectedTestKeys, manifest })
}

async function runPhase2IfNeeded(
  progress: Progress,
  phase2Version: string,
  selectedTestKeys: ReadonlySet<string>,
): Promise<import('./behavior-audit/incremental.js').ConsolidatedManifest> {
  if (progress.phase2.status === 'done' && selectedTestKeys.size === 0) {
    const existing = await loadConsolidatedManifest()
    if (existing !== null) {
      console.log('[Phase 2] Already complete, skipping.\n')
      return existing
    }
  }

  const existingManifest = await loadConsolidatedManifest()
  if (existingManifest === null) {
    return runPhase2(progress, createEmptyConsolidatedManifest(), phase2Version, selectedTestKeys)
  }
  const consolidatedManifest = existingManifest
  return runPhase2(progress, consolidatedManifest, phase2Version, selectedTestKeys)
}

async function prepareIncrementalRun(): Promise<{
  readonly previousManifest: IncrementalManifest
  readonly previousLastStartCommit: string | null
  readonly updatedManifest: IncrementalManifest
}> {
  const previousManifest = resolveRunStartManifest(await loadManifest())
  const currentHead = await resolveHeadCommit()
  const { previousLastStartCommit, updatedManifest } = captureRunStart(
    previousManifest,
    currentHead,
    new Date().toISOString(),
  )
  await saveManifest(updatedManifest)
  return { previousManifest, previousLastStartCommit, updatedManifest }
}

async function selectIncrementalRunWork(input: {
  readonly previousManifest: IncrementalManifest
  readonly previousLastStartCommit: string | null
}): Promise<{
  readonly parsedFiles: readonly ParsedTestFile[]
  readonly previousConsolidatedManifest: import('./behavior-audit/incremental.js').ConsolidatedManifest | null
  readonly selection: import('./behavior-audit/incremental.js').IncrementalSelection
}> {
  const testFilePaths = await discoverTestFiles()
  console.log(`Found ${testFilePaths.length} test files (after exclusions)\n`)
  const parsedFiles = await parseDiscoveredTestFiles(testFilePaths)
  const discoveredTestKeys = getDiscoveredTestKeys(parsedFiles)
  const changedFiles = await collectChangedFiles(input.previousLastStartCommit)
  const previousConsolidatedManifest = await loadConsolidatedManifest()
  const selection = selectIncrementalWork({
    changedFiles,
    previousManifest: input.previousManifest,
    currentPhaseVersions: input.previousManifest.phaseVersions,
    discoveredTestKeys,
    previousConsolidatedManifest,
  })
  return { parsedFiles, previousConsolidatedManifest, selection }
}

async function runPhase3IfNeeded(
  progress: Progress,
  selectedConsolidatedIds: ReadonlySet<string>,
  consolidatedManifest: import('./behavior-audit/incremental.js').ConsolidatedManifest | null,
): Promise<void> {
  if (progress.phase3.status === 'done' && selectedConsolidatedIds.size === 0) {
    console.log('[Phase 3] Already complete.\n')
    return
  }
  await runPhase3({ progress, selectedConsolidatedIds, consolidatedManifest })
}

async function resolveHeadCommit(): Promise<string> {
  const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
    cwd: PROJECT_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error('Failed to resolve HEAD commit')
  }
  return output.trim()
}

async function main(): Promise<void> {
  console.log('Behavior Audit — discovering test files...\n')

  const { previousManifest, previousLastStartCommit, updatedManifest } = await prepareIncrementalRun()
  const { parsedFiles, previousConsolidatedManifest, selection } = await selectIncrementalRunWork({
    previousManifest,
    previousLastStartCommit,
  })

  const progress = await loadOrCreateProgress(parsedFiles.length)

  if (selection.reportRebuildOnly) {
    await rebuildReportsFromStoredResults({
      manifest: updatedManifest,
      extractedBehaviorsByKey: progress.phase1.extractedBehaviors,
      evaluationsByKey: progress.phase3.evaluations,
      consolidatedManifest: previousConsolidatedManifest,
    })
    console.log('\nBehavior audit complete.')
    return
  }

  await runPhase1IfNeeded(parsedFiles, progress, new Set(selection.phase1SelectedTestKeys), updatedManifest)

  const consolidatedManifest = await runPhase2IfNeeded(
    progress,
    updatedManifest.phaseVersions.phase2,
    new Set(selection.phase2SelectedTestKeys),
  )
  await saveConsolidatedManifest(consolidatedManifest)

  await runPhase3IfNeeded(progress, new Set(selection.phase3SelectedConsolidatedIds), consolidatedManifest)

  console.log('\nBehavior audit complete.')
}

function resolveRunStartManifest(manifest: Awaited<ReturnType<typeof loadManifest>>): IncrementalManifest {
  if (manifest === null) {
    return createEmptyManifest()
  }
  return manifest
}

await main().catch((error: unknown) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
