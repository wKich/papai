import type { TestCase } from './test-parser.js'

function deriveImplPath(testPath: string): string {
  return testPath.replace(/^tests\//, 'src/').replace(/\.test\.ts$/, '.ts')
}

export function buildExtractionPrompt(testCase: TestCase, testFilePath: string): string {
  const implPath = deriveImplPath(testFilePath)
  return `**Test file:** ${testFilePath}\n**Test name:** ${testCase.fullPath}\n**Likely implementation file:** ${implPath}\n\n\`\`\`typescript\n${testCase.source}\n\`\`\``
}
