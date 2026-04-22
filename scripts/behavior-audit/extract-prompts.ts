import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'
import type { TestCase } from './test-parser.js'

function deriveImplPath(testPath: string): string {
  return testPath.replace(/^tests\//, 'src/').replace(/\.test\.ts$/, '.ts')
}

export function buildExtractionPrompt(testCase: TestCase, testFilePath: string): string {
  const implPath = deriveImplPath(testFilePath)
  return `**Test file:** ${testFilePath}\n**Test name:** ${testCase.fullPath}\n**Likely implementation file:** ${implPath}\n\n\`\`\`typescript\n${testCase.source}\n\`\`\``
}

export function buildResolverPrompt(candidateKeywords: readonly string[], vocabularyText: string): string {
  return [
    'Resolve the candidate keywords against the existing vocabulary.',
    'Reuse existing slugs when semantically appropriate.',
    'Append new entries only when no vocabulary slug adequately fits.',
    '',
    `Candidate keywords: ${candidateKeywords.join(', ')}`,
    '',
    'Existing vocabulary:',
    vocabularyText,
  ].join('\n')
}

export function buildVocabularySlugListText(existingVocabulary: readonly KeywordVocabularyEntry[]): string {
  return existingVocabulary.length === 0
    ? '(empty)'
    : JSON.stringify(
        existingVocabulary.map((entry) => entry.slug),
        null,
        2,
      )
}
