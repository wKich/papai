#!/usr/bin/env bun
/**
 * Detect duplicate code in test files using jscpd
 * Usage: bun run scripts/detect-duplicates.ts [threshold]
 * Default threshold is 15 lines (lower = more sensitive)
 */

import { $ } from 'bun'

const THRESHOLD = process.argv[2] !== undefined && process.argv[2] !== '' ? parseInt(process.argv[2], 10) : 15

console.log(`🔍 Detecting duplicate code in tests (threshold: ${THRESHOLD} lines)...\n`)

// Check if jscpd is available
async function checkJscpd(): Promise<boolean> {
  try {
    await $`which jscpd`.quiet()
    return true
  } catch {
    return false
  }
}

// Install jscpd if not available
async function installJscpd(): Promise<void> {
  console.log('⚠️  jscpd not found. Installing...')
  await $`bun add -d jscpd`
}

// Run jscpd
async function runJscpd(): Promise<void> {
  const reporterDir = './reports/jscpd'

  try {
    await $`mkdir -p ${reporterDir}`

    await $`jscpd tests/
      --min-lines ${THRESHOLD}
      --min-tokens 50
      --reporters console,html
      --output ${reporterDir}
      --ignore "**/node_modules/**,**/*.d.ts,**/e2e/**"
      --format typescript`

    console.log('\n📊 Report generated:')
    console.log('   - Console output above')
    console.log(`   - HTML report: ${reporterDir}/index.html`)
  } catch {
    // jscpd exits with error code if duplicates found, which is expected
    console.log('\n📊 Report generated:')
    console.log('   - Console output above')
    console.log(`   - HTML report: ${reporterDir}/index.html`)
    process.exit(0)
  }
}

async function main(): Promise<void> {
  const hasJscpd = await checkJscpd()
  if (!hasJscpd) {
    await installJscpd()
  }
  await runJscpd()
}

void main()
