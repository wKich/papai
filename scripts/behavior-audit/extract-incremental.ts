import { access } from 'node:fs/promises'
import { join } from 'node:path'

import { PROJECT_ROOT } from './config.js'
import { getDomain } from './domain-map.js'
import type { IncrementalManifest } from './incremental.js'
import { buildPhase1Fingerprint, hashText } from './incremental.js'
import type { ExtractedBehavior } from './report-writer.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'

function deriveImplPath(testPath: string): string {
  return testPath.replace(/^tests\//, 'src/').replace(/\.test\.ts$/, '.ts')
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function loadMirroredSourceHash(testFilePath: string): Promise<string | null> {
  const mirroredPath = deriveImplPath(testFilePath)
  const absoluteMirroredPath = join(PROJECT_ROOT, mirroredPath)
  if (!(await fileExists(absoluteMirroredPath))) {
    return null
  }
  return hashText(await Bun.file(absoluteMirroredPath).text())
}

export async function updateManifestForExtractedTest(input: {
  readonly manifest: IncrementalManifest
  readonly testFile: ParsedTestFile
  readonly testCase: TestCase
  readonly extractedBehavior: ExtractedBehavior
}): Promise<IncrementalManifest> {
  const testKey = `${input.testFile.filePath}::${input.testCase.fullPath}`
  const testFileHash = hashText(await Bun.file(join(PROJECT_ROOT, input.testFile.filePath)).text())
  const mirroredPath = deriveImplPath(input.testFile.filePath)
  const mirroredSourceHash = await loadMirroredSourceHash(input.testFile.filePath)
  const dependencyPaths =
    mirroredSourceHash === null ? [input.testFile.filePath] : [input.testFile.filePath, mirroredPath]
  const extractedBehaviorPath = `reports/behaviors/${getDomain(input.testFile.filePath)}/${input.testFile.filePath.split('/').pop()!.replace('.test.ts', '.test.behaviors.md')}`
  const previousEntry = input.manifest.tests[testKey]
  const phase1Fingerprint = buildPhase1Fingerprint({
    testKey,
    testFileHash,
    testSource: input.testCase.source,
    mirroredSourceHash,
    phaseVersion: input.manifest.phaseVersions.phase1,
  })
  const phase2Fingerprint =
    previousEntry !== undefined && previousEntry.phase1Fingerprint === phase1Fingerprint
      ? previousEntry.phase2Fingerprint
      : null
  const lastPhase2CompletedAt = phase2Fingerprint === null ? null : previousEntry!.lastPhase2CompletedAt

  return {
    ...input.manifest,
    tests: {
      ...input.manifest.tests,
      [testKey]: {
        testFile: input.testFile.filePath,
        testName: input.testCase.fullPath,
        dependencyPaths,
        phase1Fingerprint,
        phase2Fingerprint,
        extractedBehaviorPath,
        domain: getDomain(input.testFile.filePath),
        lastPhase1CompletedAt: new Date().toISOString(),
        lastPhase2CompletedAt,
      },
    },
  }
}
