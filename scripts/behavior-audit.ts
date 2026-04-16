import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { EXCLUDED_PREFIXES, PROJECT_ROOT } from './behavior-audit/config.js'
import { runPhase2 } from './behavior-audit/evaluate.js'
import { runPhase1 } from './behavior-audit/extract.js'
import type { Progress } from './behavior-audit/progress.js'
import { createEmptyProgress, loadProgress, saveProgress } from './behavior-audit/progress.js'
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
  return files.sort()
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

async function runPhase1IfNeeded(testFilePaths: readonly string[], progress: Progress): Promise<void> {
  if (progress.phase1.status === 'done') {
    console.log('[Phase 1] Already complete, skipping.\n')
    return
  }
  const parsedFiles = await Promise.all(
    testFilePaths.map(async (filePath) => {
      const content = await Bun.file(join(PROJECT_ROOT, filePath)).text()
      return parseTestFile(filePath, content)
    }),
  )
  await runPhase1(parsedFiles, progress)
}

async function runPhase2IfNeeded(progress: Progress): Promise<void> {
  if (progress.phase2.status === 'done') {
    console.log('[Phase 2] Already complete.\n')
    return
  }
  await runPhase2(progress)
}

async function main(): Promise<void> {
  console.log('Behavior Audit — discovering test files...\n')

  const testFilePaths = await discoverTestFiles()
  console.log(`Found ${testFilePaths.length} test files (after exclusions)\n`)

  const progress = await loadOrCreateProgress(testFilePaths.length)

  if (progress.phase1.status === 'not-started' || progress.phase1.status === 'in-progress') {
    await runPhase1IfNeeded(testFilePaths, progress)
  } else {
    console.log('[Phase 1] Already complete, skipping.\n')
  }

  await runPhase2IfNeeded(progress)

  console.log('\nBehavior audit complete.')
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
