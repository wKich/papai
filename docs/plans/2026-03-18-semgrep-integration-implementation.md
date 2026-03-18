# Semgrep Security Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Semgrep static analysis for AI-generated code security and TypeScript best practices into the papai project's CI/CD pipeline and local development workflow.

**Architecture:** Create `.semgrep/` configuration directory with a TypeScript runner script that downloads and manages Semgrep binary, clone AI best practices rules at runtime, and integrate into both local npm scripts and GitHub Actions CI pipeline.

**Tech Stack:** Bun, TypeScript, Semgrep, GitHub Actions

---

## Task 1: Create Semgrep Configuration Directory Structure

**Files:**

- Create: `.semgrep/config.yml`
- Create: `.semgrep/.semgrepignore`
- Create: `.semgrep/.gitignore`

**Step 1: Create `.semgrep/config.yml`**

```yaml
rules:
  # General security rules from Semgrep Registry
  - config: p/owasp-top-ten
  - config: p/typescript
  - config: p/javascript

# Scan settings
scan:
  strict: true
  error: true
  json: false

# Exclude patterns
exclude:
  - tests/
  - node_modules/
  - .git/
  - dist/
  - '*.test.ts'
  - '*.spec.ts'
  - '.semgrep/bin/'
```

**Step 2: Create `.semgrep/.semgrepignore`**

```
# Test files
tests/
**/*.test.ts
**/*.spec.ts

# Dependencies
node_modules/
.git/

# Build artifacts
dist/
*.log

# Semgrep binary
.semgrep/bin/

# Environment files
.env
.env.*

# Documentation
docs/
*.md
```

**Step 3: Create `.semgrep/.gitignore`**

```
# Downloaded semgrep binary
bin/

# Temporary rule clones
ai-best-practices/

# Scan results
results.json
results.sarif
semgrep-results.*
```

**Step 4: Verify directory structure**

Run:

```bash
ls -la .semgrep/
```

Expected: Shows config.yml, .semgrepignore, .gitignore

**Step 5: Commit**

```bash
git add .semgrep/
git commit -m "chore: add semgrep configuration directory"
```

---

## Task 2: Create Semgrep Runner Script

**Files:**

- Create: `scripts/run-semgrep.ts`

**Step 1: Write the runner script**

```typescript
#!/usr/bin/env bun
import { $ } from 'bun'
import { existsSync } from 'fs'
import { join } from 'path'

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

  await $`mkdir -p ${join(SEMGREP_DIR, 'bin')}`
  await $`curl -L -o ${SEMGREP_BIN} ${url}`
  await $`chmod +x ${SEMGREP_BIN}`

  console.log('✅ Semgrep downloaded successfully')
}

async function ensureSemgrep(): Promise<string> {
  // Check if semgrep is in PATH
  try {
    await $`which semgrep`
    const result = await $`semgrep --version`.text()
    console.log(`✅ Using system Semgrep: ${result.trim()}`)
    return 'semgrep'
  } catch {
    // Not in PATH, check local binary
    if (!existsSync(SEMGREP_BIN)) {
      await downloadSemgrep()
    }
    const result = await $`${SEMGREP_BIN} --version`.text()
    console.log(`✅ Using local Semgrep: ${result.trim()}`)
    return SEMGREP_BIN
  }
}

async function cloneAIRules(): Promise<string> {
  const aiRulesDir = join(SEMGREP_DIR, 'ai-best-practices')

  if (existsSync(aiRulesDir)) {
    console.log('🔄 Updating AI best practices rules...')
    await $`cd ${aiRulesDir} && git pull --depth 1`
  } else {
    console.log('📥 Cloning AI best practices rules...')
    await $`git clone --depth 1 https://github.com/semgrep/ai-best-practices.git ${aiRulesDir}`
  }

  console.log('✅ AI rules ready')
  return join(aiRulesDir, 'rules')
}

async function runSemgrep(semgrepPath: string, aiRulesPath: string, options: RunOptions): Promise<number> {
  const args = ['scan', '--config', join(SEMGREP_DIR, 'config.yml'), '--config', aiRulesPath, '--strict', '--error']

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

main()
```

**Step 2: Verify script is executable**

Run:

```bash
chmod +x scripts/run-semgrep.ts
```

**Step 3: Commit**

```bash
git add scripts/run-semgrep.ts
git commit -m "feat: add semgrep runner script with AI rules support"
```

---

## Task 3: Add npm Scripts

**Files:**

- Modify: `package.json`

**Step 1: Read current package.json**

Run:

```bash
cat package.json | grep -A 20 '"scripts"'
```

Expected: Shows existing scripts including "security" placeholder or not

**Step 2: Add security scripts**

Modify `package.json` scripts section to add:

```json
"security": "bun run scripts/run-semgrep.ts",
"security:ci": "bun run scripts/run-semgrep.ts --ci"
```

The scripts section should look like:

```json
"scripts": {
  "start": "bun run src/index.ts",
  "knip": "knip-bun",
  "lint": "oxlint .",
  "lint:fix": "oxlint --fix .",
  "format": "oxfmt --write . --ignore-path=.oxfmtignore",
  "format:check": "oxfmt --check . --ignore-path=.oxfmtignore",
  "security": "bun run scripts/run-semgrep.ts",
  "security:ci": "bun run scripts/run-semgrep.ts --ci",
  "test": "bun test tests/kaneo tests/tools tests/providers tests/scripts tests/db tests/utils tests/*.test.ts",
  ...
}
```

**Step 3: Verify scripts added**

Run:

```bash
cat package.json | grep -A 2 '"security"'
```

Expected: Shows both security and security:ci scripts

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add security npm scripts for semgrep"
```

---

## Task 4: Update Pre-commit Hook

**Files:**

- Modify: `scripts/pre-commit.sh`

**Step 1: Read current pre-commit hook**

Run:

```bash
cat scripts/pre-commit.sh
```

Expected: Shows existing lint/format checks

**Step 2: Add security scan to pre-commit**

Add security scan before the final echo:

```bash
# Run security scan
echo "Running security scan..."
bun run security -- --error
if [ $? -ne 0 ]; then
    echo "❌ Security scan failed. Fix issues before committing."
    exit 1
fi
```

**Step 3: Verify hook updated**

Run:

```bash
grep -A 5 "security scan" scripts/pre-commit.sh
```

Expected: Shows the security check block

**Step 4: Commit**

```bash
git add scripts/pre-commit.sh
git commit -m "chore: add security scan to pre-commit hook"
```

---

## Task 5: Add CI/CD Job

**Files:**

- Modify: `.github/workflows/ci.yml`

**Step 1: Read current CI workflow**

Run:

```bash
cat .github/workflows/ci.yml
```

Expected: Shows existing jobs: format, lint, typecheck, test, e2e

**Step 2: Add security job after lint job**

Add this job definition after the lint job:

```yaml
security:
  name: Security Scan
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: latest
    - name: Install dependencies
      run: bun install
    - name: Clone AI best practices rules
      run: |
        git clone --depth 1 https://github.com/semgrep/ai-best-practices.git /tmp/ai-best-practices
    - name: Run Semgrep security scan
      run: bun run security:ci
      env:
        SEMGREP_RULES: '/tmp/ai-best-practices/rules/'
    - name: Upload SARIF to GitHub Security tab
      uses: github/codeql-action/upload-sarif@v3
      if: always() && hashFiles('semgrep-results.sarif') != ''
      with:
        sarif_file: semgrep-results.sarif
```

**Step 3: Update SARIF generation in runner script**

Modify `scripts/run-semgrep.ts` to generate SARIF in CI mode:

Add to the runSemgrep function after the json output line:

```typescript
if (options.ci) {
  args.push('--json', '--output', 'semgrep-results.json')
  args.push('--sarif', '--output', 'semgrep-results.sarif')
}
```

**Step 4: Verify CI workflow updated**

Run:

```bash
grep -A 20 "Security Scan" .github/workflows/ci.yml
```

Expected: Shows the complete security job definition

**Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts/run-semgrep.ts
git commit -m "ci: add semgrep security scan job"
```

---

## Task 6: Test Local Execution

**Files:**

- No file changes, testing only

**Step 1: Run security scan locally**

Run:

```bash
bun run security
```

Expected:

- Downloads Semgrep binary (first run)
- Clones AI best practices rules
- Runs scan
- Shows results or "no issues found"

**Step 2: Verify binary cached**

Run:

```bash
ls -la .semgrep/bin/
```

Expected: Shows semgrep binary

**Step 3: Run again (should use cache)**

Run:

```bash
bun run security
```

Expected:

- Uses cached binary (no download message)
- Uses cached rules (update instead of clone)
- Runs scan

**Step 4: Test CI mode**

Run:

```bash
bun run security:ci
```

Expected:

- Runs scan
- Generates semgrep-results.json

**Step 5: Check results file**

Run:

```bash
ls -la semgrep-results.json
```

Expected: File exists (may be empty array if clean)

---

## Task 7: Initial Scan Tuning

**Files:**

- Depends on findings

**Step 1: Run full scan and capture output**

Run:

```bash
bun run security 2>&1 | tee initial-scan.txt
```

**Step 2: Review findings**

Check if any findings are false positives that need suppression.

**Step 3: Add suppressions for false positives**

For each false positive, add comment to the code:

```typescript
// nosemgrep: <rule-id>
// Reason: <explanation>
<code>
```

**Step 4: Commit suppressions**

```bash
git add -A
git commit -m "chore: add semgrep suppressions for false positives"
```

**Step 5: Verify clean scan**

Run:

```bash
bun run security
```

Expected: "✅ Security scan passed - no issues found"

---

## Task 8: Documentation Update

**Files:**

- Modify: `CLAUDE.md`

**Step 1: Add security section to CLAUDE.md**

Add after the "Commands" section:

```markdown
## Security

- `bun run security` — run Semgrep security scan locally
- `bun run security:ci` — run scan with JSON/SARIF output for CI

Security scans check for:

- OWASP Top 10 vulnerabilities
- TypeScript/JavaScript best practices
- AI/LLM-specific security issues (hardcoded API keys, prompt injection, etc.)

The scan runs automatically in CI on every PR and push to master.
```

**Step 2: Commit documentation**

```bash
git add CLAUDE.md
git commit -m "docs: add security scan documentation to CLAUDE.md"
```

---

## Success Criteria Verification

**Step 1: Verify all components**

Run each check:

```bash
# Check configuration exists
ls .semgrep/config.yml .semgrep/.semgrepignore .semgrep/.gitignore

# Check runner script exists
ls scripts/run-semgrep.ts

# Check npm scripts
bun run security -- --help 2>&1 | head -5

# Check CI workflow
grep -q "Security Scan" .github/workflows/ci.yml && echo "CI job present"

# Check pre-commit hook
grep -q "security scan" scripts/pre-commit.sh && echo "Pre-commit hook updated"
```

**Step 2: Run final verification**

```bash
bun run security
```

Expected: Clean exit with success message

**Step 3: Final commit**

```bash
git status
```

Ensure all changes are committed.

---

## Implementation Complete

The Semgrep security integration is now fully implemented with:

1. ✅ Configuration directory (`.semgrep/`)
2. ✅ Runner script (`scripts/run-semgrep.ts`)
3. ✅ npm scripts (`bun run security`, `bun run security:ci`)
4. ✅ Pre-commit hook integration
5. ✅ CI/CD job in GitHub Actions
6. ✅ AI best practices rules support
7. ✅ Documentation updated

The integration will catch:

- Hardcoded API keys
- Prompt injection vulnerabilities
- Missing error handling in LLM calls
- OWASP Top 10 issues
- TypeScript/JavaScript security issues
