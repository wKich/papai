import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

const CodeindexConfigSchema = z.object({
  roots: z.array(z.string().min(1)).default(['src']),
  exclude: z.array(z.string().min(1)).default(['node_modules', 'dist', '.git', 'coverage', '**/*.test.*', '**/*.spec.*']),
  languages: z.array(z.enum(['ts', 'tsx', 'js', 'jsx'])).default(['ts', 'tsx', 'js', 'jsx']),
  dbPath: z.string().min(1).default('.codeindex/index.db'),
  indexLocals: z.boolean().default(true),
  indexVariables: z.boolean().default(true),
  includeDocComments: z.boolean().default(true),
  maxStoredBodyLines: z.number().int().positive().default(120),
  tsconfigPaths: z.array(z.string().min(1)).default(['tsconfig.json']),
})

export type CodeindexConfig = Readonly<
  z.infer<typeof CodeindexConfigSchema> & {
    repoRoot: string
    configPath: string
    dbPath: string
    roots: readonly string[]
    tsconfigPaths: readonly string[]
  }
>

export interface LoadCodeindexConfigInput {
  configPath: string
  repoRoot?: string
}

export const loadCodeindexConfig = async (input: Readonly<LoadCodeindexConfigInput>): Promise<CodeindexConfig> => {
  const configPath = path.resolve(input.configPath)
  const configDir = path.dirname(configPath)
  const repoRoot = input.repoRoot === undefined ? configDir : path.resolve(input.repoRoot)
  const fileContents = await readFile(configPath, 'utf8')
  const parsed = CodeindexConfigSchema.parse(JSON.parse(fileContents) as unknown)
  const resolvedDbPath = path.resolve(repoRoot, parsed.dbPath)

  await mkdir(path.dirname(resolvedDbPath), { recursive: true })

  return {
    ...parsed,
    configPath,
    repoRoot,
    dbPath: resolvedDbPath,
    roots: parsed.roots.map((entry) => path.resolve(repoRoot, entry)),
    tsconfigPaths: parsed.tsconfigPaths.map((entry) => path.resolve(repoRoot, entry)),
  }
}
