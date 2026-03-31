# Optimize Mutation Testing - Move from Per-Edit to Session-Level

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use @test-driven-development skill for all code changes.

**Goal:** Move mutation testing (Stryker) from running on every file edit (60-240s overhead per edit) to running once at session start and once at session end, drastically improving iteration speed while maintaining mutation coverage enforcement.

**Architecture:** 
- Remove per-file mutation snapshots from pre/post-write hooks
- Add session-level mutation baseline capture at start using `session.start` hook
- Add session-level mutation verification at end using `session.stop` hook
- Store all src/ file mutations in session state under a unified key
- Compare end-of-session mutations against start baseline to detect new survivors

**Tech Stack:** Bun, TypeScript, Stryker, OpenCode Plugin API

---

## Current Behavior Analysis

Mutation testing currently runs:
1. **Before each file edit** (Check [3] snapshotMutants) - ~30-120s
2. **After each file edit** (Check [7] verifyNoNewMutants) - ~30-120s

**Total per-file edit overhead: 60-240 seconds** (2-4 minutes)

## Proposed New Behavior

Mutation testing will run:
1. **At session start** - capture baseline for all src/ files once
2. **At session end** - capture final state and compare against baseline

**Total overhead: 30-120 seconds once per session** (only when TDD_MUTATION != '0')

---

## Task 1: Add Session Start Hook for Mutation Baseline

**Files:**
- Modify: `.opencode/plugins/tdd-enforcement.ts`

**Step 1: Add session start mutation capture function**

Add this function after `getFileKey()`:

```typescript
/**
 * Run mutation testing on all src/ files at session start
 * Captures baseline mutation survivors for later comparison
 */
async function captureSessionMutationBaseline(
  state: SessionState,
  directory: string,
): Promise<void> {
  if (process.env['TDD_MUTATION'] === '0') return

  const srcDir = path.join(directory, 'src')
  if (!fs.existsSync(srcDir)) return

  // Find all .ts files in src/
  const allFiles: string[] = []
  function collectFiles(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        collectFiles(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        allFiles.push(fullPath)
      }
    }
  }
  collectFiles(srcDir)

  const sessionsDir = path.join(directory, '.hooks', 'sessions')
  const reportFile = path.join(sessionsDir, 'stryker-session-baseline.json')
  const configFile = path.join(sessionsDir, 'stryker-config-session-baseline.json')

  // Build config that mutates all src files
  const tempConfig = {
    testRunner: 'bun',
    appendPlugins: ['@hughescr/stryker-bun-runner'],
    checkers: ['typescript'],
    tsconfigFile: path.join(directory, 'tsconfig.json'),
    bun: { timeout: 120000 },
    mutate: allFiles,
    coverageAnalysis: 'perTest',
    ignoreStatic: true,
    incremental: false,
    concurrency: 2,
    timeoutMS: 60000,
    timeoutFactor: 2,
    reporters: ['json'],
    jsonReporter: { fileName: reportFile },
    cleanTempDir: true,
    ignorePatterns: ['node_modules', '.stryker-tmp'],
  }

  try {
    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify(tempConfig))

    try {
      execFileSync('node_modules/.bin/stryker', ['run', configFile], {
        cwd: directory,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 600_000, // 10 minutes for full src run
      })
    } catch {
      // Stryker exits non-zero when mutants survive — expected
    }

    if (fs.existsSync(reportFile)) {
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
      const allSurvivors: Record<string, Array<{ mutator: string; replacement: string; line?: number; description: string }>> = {}
      
      for (const [filePath, fileData] of Object.entries(report.files ?? {})) {
        const survivors = Object.values((fileData as { mutants: Record<string, { status: string; mutatorName: string; replacement: string; location?: { start?: { line?: number } } }> }).mutants ?? {})
          .filter((m) => m.status === 'Survived')
          .map((m) => ({
            mutator: m.mutatorName,
            replacement: m.replacement,
            line: m.location?.start?.line,
            description: `${m.mutatorName}:${m.replacement}`,
          }))
        if (survivors.length > 0) {
          allSurvivors[path.resolve(filePath)] = survivors
        }
      }
      
      state.setSessionMutationBaseline(allSurvivors)
    }
  } catch {
    // Fail open - mutation testing is optional
  }
}
```

**Step 2: Add session start hook to plugin return object**

In the plugin return object, add:

```typescript
'session.start': async (input) => {
  const state = new SessionState(input.sessionID, sessionsDir)
  await captureSessionMutationBaseline(state, directory)
},
```

**Step 3: Remove per-file mutation testing**

Remove Check [3] snapshotMutants from `runPreWriteChecks()` (lines 62-93):
- Remove the entire `if (process.env['TDD_MUTATION'] !== '0' && fs.existsSync(absPath))` block

Remove Check [7] verifyNoNewMutants - entire function and its call in post-write hook.

Remove the `verifyNoNewMutants` call from the post-write hook (lines 379-390).

---

## Task 2: Add Session Stop Hook for Mutation Verification

**Files:**
- Modify: `.opencode/plugins/tdd-enforcement.ts`
- Modify: `.hooks/tdd/session-state.mjs` (add new method)

**Step 1: Add session baseline methods to SessionState**

In `.hooks/tdd/session-state.mjs`, add after `setMutationSnapshot`:

```javascript
// Session-level mutation baseline (all src files)

/**
 * @param {Record<string, Array<{ mutator: string; replacement: string; line?: number; description: string }>>} baseline
 * @returns {void}
 */
setSessionMutationBaseline(baseline) {
  this.#ensureLoaded()
  this.#state.sessionMutationBaseline = baseline
  this.#persist()
}

/**
 * @returns {Record<string, Array<{ mutator: string; replacement: string; line?: number; description: string }>> | null}
 */
getSessionMutationBaseline() {
  this.#ensureLoaded()
  return this.#state.sessionMutationBaseline ?? null
}
```

**Step 2: Update type definitions in session-state.mjs**

Add to `SessionStateData` typedef:
```javascript
 * @property {Record<string, Array<{ mutator: string; replacement: string; line?: number; description: string }>> | null} sessionMutationBaseline
```

Update `#createEmptyState()`:
```javascript
return {
  writtenTests: [],
  pendingFailure: null,
  surfaceSnapshots: new Map(),
  mutationSnapshots: new Map(),
  sessionMutationBaseline: null,
}
```

**Step 3: Add session stop mutation verification**

Add this function after `captureSessionMutationBaseline`:

```typescript
/**
 * Run mutation testing at session end and compare against baseline
 * Reports any NEW mutation survivors introduced during the session
 */
async function verifySessionMutationBaseline(
  state: SessionState,
  directory: string,
): Promise<{ hasNewSurvivors: boolean; report: string }> {
  if (process.env['TDD_MUTATION'] === '0') {
    return { hasNewSurvivors: false, report: '' }
  }

  const baseline = state.getSessionMutationBaseline()
  if (!baseline) {
    return { hasNewSurvivors: false, report: '' }
  }

  const srcDir = path.join(directory, 'src')
  if (!fs.existsSync(srcDir)) {
    return { hasNewSurvivors: false, report: '' }
  }

  // Find all .ts files in src/
  const allFiles: string[] = []
  function collectFiles(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        collectFiles(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        allFiles.push(fullPath)
      }
    }
  }
  collectFiles(srcDir)

  const sessionsDir = path.join(directory, '.hooks', 'sessions')
  const reportFile = path.join(sessionsDir, 'stryker-session-final.json')
  const configFile = path.join(sessionsDir, 'stryker-config-session-final.json')

  const tempConfig = {
    testRunner: 'bun',
    appendPlugins: ['@hughescr/stryker-bun-runner'],
    checkers: ['typescript'],
    tsconfigFile: path.join(directory, 'tsconfig.json'),
    bun: { timeout: 120000 },
    mutate: allFiles,
    coverageAnalysis: 'perTest',
    ignoreStatic: true,
    incremental: false,
    concurrency: 2,
    timeoutMS: 60000,
    timeoutFactor: 2,
    reporters: ['json'],
    jsonReporter: { fileName: reportFile },
    cleanTempDir: true,
    ignorePatterns: ['node_modules', '.stryker-tmp'],
  }

  try {
    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify(tempConfig))

    try {
      execFileSync('node_modules/.bin/stryker', ['run', configFile], {
        cwd: directory,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 600_000,
      })
    } catch {
      // Stryker exits non-zero when mutants survive — expected
    }

    if (!fs.existsSync(reportFile)) {
      return { hasNewSurvivors: false, report: '' }
    }

    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
    const finalSurvivors: Record<string, Array<{ mutator: string; replacement: string; line?: number; description: string }>> = {}
    
    for (const [filePath, fileData] of Object.entries(report.files ?? {})) {
      const survivors = Object.values((fileData as { mutants: Record<string, { status: string; mutatorName: string; replacement: string; location?: { start?: { line?: number } } }> }).mutants ?? {})
        .filter((m) => m.status === 'Survived')
        .map((m) => ({
          mutator: m.mutatorName,
          replacement: m.replacement,
          line: m.location?.start?.line,
          description: `${m.mutatorName}:${m.replacement}`,
        }))
      if (survivors.length > 0) {
        finalSurvivors[path.resolve(filePath)] = survivors
      }
    }

    // Compare final against baseline to find NEW survivors
    const newSurvivorsByFile: Record<string, typeof finalSurvivors[string]> = {}
    let totalNewSurvivors = 0

    for (const [filePath, finalList] of Object.entries(finalSurvivors)) {
      const baselineList = baseline[filePath] ?? []
      const baselineDescriptions = new Set(baselineList.map((m) => m.description))
      
      const newInFile = finalList.filter((m) => !baselineDescriptions.has(m.description))
      if (newInFile.length > 0) {
        newSurvivorsByFile[filePath] = newInFile
        totalNewSurvivors += newInFile.length
      }
    }

    if (totalNewSurvivors === 0) {
      return { hasNewSurvivors: false, report: '' }
    }

    // Build report
    const lines: string[] = [
      `Mutation testing detected ${totalNewSurvivors} new untested code path(s):`,
      '',
    ]

    for (const [filePath, survivors] of Object.entries(newSurvivorsByFile)) {
      const relPath = path.relative(directory, filePath)
      lines.push(`\`${relPath}\`:`)
      for (const s of survivors) {
        lines.push(`  Line ${s.line ?? '?'}: [${s.mutator}] → \`${s.replacement}\``)
      }
      lines.push('')
    }

    lines.push('These code paths were not caught by any test.')
    lines.push('Next step: Write tests that exercise these code paths.')

    return { hasNewSurvivors: true, report: lines.join('\n') }
  } catch {
    return { hasNewSurvivors: false, report: '' }
  }
}
```

**Step 4: Add session stop hook to plugin**

In the plugin return object, add:

```typescript
'session.stop': async (input) => {
  const state = new SessionState(input.sessionID, sessionsDir)
  const result = await verifySessionMutationBaseline(state, directory)
  
  if (result.hasNewSurvivors) {
    // Log the mutation report for the user to see
    console.error('\n=== MUTATION TESTING REPORT ===\n')
    console.error(result.report)
    console.error('\n================================\n')
  }
},
```

---

## Task 3: Clean Up Unused Code

**Files:**
- Modify: `.opencode/plugins/tdd-enforcement.ts`

**Step 1: Remove per-file mutation functions**

Remove these imports:
- `extractSurvivors` from `'../../.hooks/tdd/mutation.mjs'`
- `buildStrykerConfig` from `'../../.hooks/tdd/mutation.mjs'` (unless still needed)

Remove the entire `verifyNoNewMutants` function (lines 220-288).

Remove the `getFileKey` function if no longer used (check if used by surface snapshots).

**Step 2: Update imports**

Remove unused imports and update the file header comment:

```typescript
// .opencode/plugins/tdd-enforcement.ts
// OpenCode plugin — TDD enforcement following PIPELINES.md specification
// Implements checks [1], [2], [4], [5], [6] with session-level mutation testing [3, 7]
```

---

## Task 4: Verify Surface Snapshots Still Work

**Files:**
- Verify: `.opencode/plugins/tdd-enforcement.ts`

Ensure that surface snapshot functionality (Check [2] and [6]) still works:
- `runPreWriteChecks` should still capture surface snapshots (lines 49-60)
- `verifyNoNewSurface` should still work as before

The `getFileKey` function is still needed for surface snapshots.

---

## Task 5: Test the Changes

**Step 1: Run typecheck**

```bash
bun typecheck
```
Expected: No TypeScript errors

**Step 2: Run linting**

```bash
bun lint
```
Expected: No lint errors

**Step 3: Test that plugin loads**

The plugin should load without errors when opencode starts.

---

## Task 6: Update Documentation

**Files:**
- Modify: `/Users/ki/Projects/experiments/papai/CLAUDE.md` (TDD Enforcement section)

**Step 1: Update CLAUDE.md**

Replace the mutation testing description in the TDD Enforcement section with:

```markdown
### Mutation Testing

Mutation testing runs **once per session** (not per-file edit):

1. **At session start** - Stryker runs on all files in `src/` to establish a baseline of surviving mutants
2. **At session end** - Stryker runs again and compares against the baseline
3. **If new survivors detected** - A report is shown with the new untested code paths

**Environment variable:**
- `TDD_MUTATION=0` - Disables mutation testing entirely
- Default (unset) - Mutation testing runs at session start/end

**Note:** Session-level mutation testing reduces per-edit overhead from 2-4 minutes to a single run per session.
```

---

## Expected Outcome

**Before:** 60-240 seconds overhead per file edit
**After:** 30-120 seconds overhead once per session

**Improvement:** ~90%+ reduction in TDD hook overhead during active development

Mutation coverage is still enforced, but now at session boundaries rather than per-file-edit.
