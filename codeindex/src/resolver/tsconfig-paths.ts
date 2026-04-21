import { existsSync } from 'node:fs'
import path from 'node:path'

import * as ts from 'typescript'

export interface TsconfigAliasRule {
  readonly pattern: string
  readonly replacements: readonly string[]
}

interface TsconfigJson {
  readonly compilerOptions?: {
    readonly baseUrl?: string
    readonly paths?: Readonly<Record<string, readonly string[]>>
  }
}

const NO_INPUTS_FOUND_DIAGNOSTIC = 18003

const readTsconfig = (tsconfigPath: string): TsconfigJson => {
  const configFile = ts.readConfigFile(tsconfigPath, (configPath) => ts.sys.readFile(configPath))
  if (configFile.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath), {}, tsconfigPath)
  const firstError = parsed.errors[0]
  if (firstError !== undefined && firstError.code !== NO_INPUTS_FOUND_DIAGNOSTIC) {
    throw new Error(ts.flattenDiagnosticMessageText(firstError.messageText, '\n'))
  }

  // pathsBasePath is the non-deprecated runtime property for resolving paths aliases;
  // it follows the extends chain and is always absolute. Not in public TS d.ts, hence the lookup.
  const opts = parsed.options as Record<string, unknown>
  const pathsBasePath = typeof opts['pathsBasePath'] === 'string' ? opts['pathsBasePath'] : undefined

  return {
    compilerOptions: {
      baseUrl: pathsBasePath,
      paths: parsed.options.paths,
    },
  }
}

const expandTsconfigPathRules = (tsconfigPath: string): readonly TsconfigAliasRule[] => {
  if (!existsSync(tsconfigPath)) {
    return []
  }
  const parsed = readTsconfig(tsconfigPath)
  const baseDir = path.dirname(tsconfigPath)
  const resolvedBase = parsed.compilerOptions?.baseUrl ?? baseDir
  const paths = parsed.compilerOptions?.paths ?? {}

  return Object.entries(paths).map(([pattern, replacements]) => ({
    pattern,
    replacements: replacements.map((replacement) => path.resolve(resolvedBase, replacement)),
  }))
}

export const loadTsconfigPathAliases = (tsconfigPaths: readonly string[]): readonly TsconfigAliasRule[] =>
  tsconfigPaths.flatMap((tsconfigPath) => expandTsconfigPathRules(tsconfigPath))

export const expandTsconfigAliasesForFile = (
  absoluteFilePath: string,
  rules: readonly TsconfigAliasRule[],
): readonly {
  aliasKey: string
  aliasKind: 'tsconfig_path'
  precedence: number
}[] =>
  rules.flatMap((rule) =>
    rule.replacements.flatMap((replacement) => {
      const wildcardIndex = replacement.indexOf('*')
      if (wildcardIndex === -1) {
        return []
      }

      const replacementPrefix = replacement.slice(0, wildcardIndex)
      if (!absoluteFilePath.startsWith(replacementPrefix)) {
        return []
      }

      const suffix = absoluteFilePath
        .slice(replacementPrefix.length)
        .split(path.sep)
        .join('/')
        .replace(/\.[^.]+$/, '')

      return [
        {
          aliasKey: rule.pattern.replaceAll('*', suffix),
          aliasKind: 'tsconfig_path',
          precedence: 80,
        },
      ]
    }),
  )
