import { join } from 'node:path'

import { BEHAVIORS_DIR, CLASSIFIED_DIR, CONSOLIDATED_DIR, EVALUATED_DIR, EXTRACTED_DIR } from './config.js'
import { getDomain } from './domain-map.js'

function getTestArtifactFileName(testFilePath: string, extension: '.test.json' | '.test.behaviors.md'): string {
  const fileName = testFilePath.split('/').pop()
  if (fileName === undefined) {
    throw new Error(`Invalid test file path: ${testFilePath}`)
  }

  return fileName.replace('.test.ts', extension)
}

export function extractedArtifactPathForTestFile(testFilePath: string): string {
  return join(EXTRACTED_DIR, getDomain(testFilePath), getTestArtifactFileName(testFilePath, '.test.json'))
}

export function classifiedArtifactPathForTestFile(testFilePath: string): string {
  return join(CLASSIFIED_DIR, getDomain(testFilePath), getTestArtifactFileName(testFilePath, '.test.json'))
}

export function consolidatedArtifactPathForFeatureKey(featureKey: string): string {
  return join(CONSOLIDATED_DIR, `${featureKey}.json`)
}

export function evaluatedArtifactPathForFeatureKey(featureKey: string): string {
  return join(EVALUATED_DIR, `${featureKey}.json`)
}

export function behaviorMarkdownPathForTestFile(testFilePath: string): string {
  return join(BEHAVIORS_DIR, getDomain(testFilePath), getTestArtifactFileName(testFilePath, '.test.behaviors.md'))
}
