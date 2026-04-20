import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import ignore from 'ignore'

import type { SupportedLanguage } from '../types.js'

export interface DiscoverSourceFilesInput {
  readonly repoRoot: string
  readonly roots: readonly string[]
  readonly exclude: readonly string[]
  readonly languages: readonly SupportedLanguage[]
}

export interface DiscoveredFile {
  readonly absolutePath: string
  readonly relativePath: string
  readonly extension: string
}

const supportedExtensionsFor = (languages: readonly SupportedLanguage[]): ReadonlySet<string> =>
  new Set(languages.map((language) => `.${language}`))

const readGitignore = async (repoRoot: string): Promise<string> => {
  try {
    return await readFile(path.join(repoRoot, '.gitignore'), 'utf8')
  } catch {
    return ''
  }
}

const walk = async (dir: string, repoRoot: string, matcher: ReturnType<typeof ignore>): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const discovered = await Promise.all(
    entries.map((entry): Promise<readonly string[]> => {
      const absolutePath = path.join(dir, entry.name)
      const relativePath = path.relative(repoRoot, absolutePath)

      if (matcher.ignores(relativePath)) {
        return Promise.resolve([])
      }
      if (entry.isDirectory()) {
        return walk(absolutePath, repoRoot, matcher)
      }
      if (entry.isFile()) {
        return Promise.resolve([absolutePath])
      }
      return Promise.resolve([])
    }),
  )

  return discovered.flat()
}

export const discoverSourceFiles = async (
  input: Readonly<DiscoverSourceFilesInput>,
): Promise<readonly DiscoveredFile[]> => {
  const matcher = ignore()
    .add(await readGitignore(input.repoRoot))
    .add([...input.exclude])
  const supportedExtensions = supportedExtensionsFor(input.languages)
  const files = await Promise.all(input.roots.map((root) => walk(root, input.repoRoot, matcher)))

  return files
    .flat()
    .map((absolutePath) => {
      const relativePath = path.relative(input.repoRoot, absolutePath)
      return {
        absolutePath,
        relativePath,
        extension: path.extname(absolutePath),
      }
    })
    .filter((entry) => supportedExtensions.has(entry.extension))
    .filter((entry) => !matcher.ignores(entry.relativePath))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}
