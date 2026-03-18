#!/usr/bin/env bun
import { existsSync } from 'fs'
import { join } from 'path'

import { $ } from 'bun'

const SEMGREP_VERSION = '1.138.0'
const SEMGREP_DIR = join(process.cwd(), '.semgrep')
const SEMGREP_BIN = join(SEMGREP_DIR, 'bin', 'semgrep')

interface RunOptions {
  ci: boolean
  fix: boolean
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2)
  return {
    ci: args.includes('--ci'),
    fix: args.includes('--fix'),
  }
}

async function downloadSemgrep(): Promise<void> {
  console.log('📦 Downloading Semgrep...')

  const platform = process.platform
  const arch = process.arch

  let binaryName: string
  if (platform === 'darwin') {
    binaryName = arch === 'arm64' ? 'semgrep-osx-arm64' : 'semgrep-osx-x86_64'
  } else if (platform === 'linux') {
    binaryName = arch === 'arm64' ? 'semgrep-manylinux2014_aarch64' : 'semgrep-manylinux2014_x86_64'
  } else {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  const url = `https://github.com/semgrep/semgrep/releases/download/v${SEMGREP_VERSION}/${binaryName}`

  const binDir = join(SEMGREP_DIR, 'bin')
  await $`mkdir -p ${binDir}`
  await $`curl -L -o ${SEMGREP_BIN} ${url}`
  await $`chmod +x ${SEMGREP_BIN}`

  console.log('✅ Semgrep downloaded successfully')
}

async function ensureSemgrep(): Promise<string> {
  // Check if semgrep is in PATH
  try {
    const whichResult = await $`which semgrep`.nothrow().quiet()
    if (whichResult.exitCode === 0) {
      const result = await $`semgrep --version`.text()
      console.log(`✅ Using system Semgrep: ${result.trim()}`)
      return 'semgrep'
    }
  } catch {
    // Not in PATH
  }

  // Check local binary
  if (!existsSync(SEMGREP_BIN)) {
    await downloadSemgrep()
  }
  const result = await $`${SEMGREP_BIN} --version`.text()
  console.log(`✅ Using local Semgrep: ${result.trim()}`)
  return SEMGREP_BIN
}

async function cloneAIRules(): Promise<string> {
  const aiRulesDir = join(SEMGREP_DIR, 'ai-best-practices')

  if (existsSync(aiRulesDir)) {
    console.log('🔄 Updating AI best practices rules...')
    await $`git -C ${aiRulesDir} pull --depth 1`.nothrow().quiet()
  } else {
    console.log('📥 Cloning AI best practices rules...')
    await $`git clone --depth 1 https://github.com/semgrep/ai-best-practices.git ${aiRulesDir}`
  }

  console.log('✅ AI rules ready')
  return join(aiRulesDir, 'rules')
}

async function runSemgrep(semgrepPath: string, aiRulesPath: string, options: RunOptions): Promise<number> {
  const args: string[] = [
    'scan',
    '--config',
    join(SEMGREP_DIR, 'config.yml'),
    '--config',
    aiRulesPath,
    '--strict',
    '--error',
  ]

  if (options.ci) {
    args.push('--json', '--output', 'semgrep-results.json')
  }

  if (options.fix) {
    args.push('--autofix')
  }

  // Add exclude patterns
  const excludes = ['tests', 'node_modules', '.git', 'dist', '*.test.ts', '*.spec.ts', '.semgrep/bin']

  for (const exclude of excludes) {
    args.push('--exclude', exclude)
  }

  // Add the scan target (current directory)
  args.push('.')

  console.log('\n🔍 Running security scan...\n')

  try {
    const result = await $`${semgrepPath} ${args}`.nothrow()
    return result.exitCode
  } catch (error) {
    console.error('❌ Semgrep execution failed:', error)
    return 2
  }
}

async function main(): Promise<void> {
  const options = parseArgs()

  try {
    const semgrepPath = await ensureSemgrep()
    const aiRulesPath = await cloneAIRules()
    const exitCode = await runSemgrep(semgrepPath, aiRulesPath, options)

    if (exitCode === 0) {
      console.log('\n✅ Security scan passed - no issues found')
    } else if (exitCode === 1) {
      console.log('\n⚠️  Security scan found issues')
      if (options.ci && existsSync('semgrep-results.json')) {
        console.log('📄 Results saved to semgrep-results.json')
      }
    } else {
      console.log('\n❌ Security scan failed to run')
    }

    process.exit(exitCode)
  } catch (error) {
    console.error('❌ Fatal error:', error)
    process.exit(2)
  }
}

void main()
