import path from 'node:path'

export interface ModuleAlias {
  readonly aliasKey: string
  readonly aliasKind: 'extensionless' | 'index_collapse' | 'tsconfig_path'
  readonly precedence: number
}

export interface ModuleIdentity {
  readonly moduleKey: string
  readonly aliases: readonly ModuleAlias[]
}

const stripExtension = (filePath: string): string => filePath.replace(/\.[^.]+$/, '')

export const buildModuleIdentity = (relativeFilePath: string): ModuleIdentity => {
  const normalized = relativeFilePath.split(path.sep).join('/')
  const moduleKey = stripExtension(normalized)
  const aliases: ModuleAlias[] = [
    {
      aliasKey: moduleKey,
      aliasKind: 'extensionless',
      precedence: 100,
    },
  ]

  if (moduleKey.endsWith('/index')) {
    aliases.push({
      aliasKey: moduleKey.slice(0, -'/index'.length),
      aliasKind: 'index_collapse',
      precedence: 90,
    })
  }

  return {
    moduleKey,
    aliases,
  }
}
