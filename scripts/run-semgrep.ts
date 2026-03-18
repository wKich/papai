#!/usr/bin/env bun
import { existsSync } from 'fs'
import { join } from 'path'

import { $ } from 'bun'

const SEMGREP_DIR = join(process.cwd(), '.semgrep')

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

async function installSemgrep(): Promise<void> {
  console.log('📦 Installing Semgrep via pip...')
  await $`python3 -m pip install semgrep --quiet`
  console.log('✅ Semgrep installed successfully')
}

async function ensureSemgrep(): Promise<string> {
  // Check if semgrep is already in PATH
  const whichResult = await $`which semgrep`.nothrow().quiet()
  if (whichResult.exitCode === 0) {
    const result = await $`semgrep --version`.text()
    console.log(`✅ Using system Semgrep: ${result.trim()}`)
    return 'semgrep'
  }

  // Not found — install via pip
  await installSemgrep()
  const result = await $`semgrep --version`.text()
  console.log(`✅ Installed Semgrep: ${result.trim()}`)
  return 'semgrep'
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
