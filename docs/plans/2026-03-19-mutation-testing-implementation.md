# Mutation Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up StrykerJS with the command runner to enable mutation testing as a local dev tool and CI quality gate.

**Architecture:** StrykerJS runs `bun test` via the command runner for each mutant. The TypeScript checker pre-filters compile-error mutants. Incremental mode caches results for fast re-runs. CI caches the incremental file across runs via `actions/cache`.

**Tech Stack:** `@stryker-mutator/core`, `@stryker-mutator/typescript-checker`, Bun test runner (via command), GitHub Actions

---

### Task 1: Install dependencies

**Files:**

- Modify: `package.json`

**Step 1: Install Stryker packages**

Run:

```bash
bun add -d @stryker-mutator/core @stryker-mutator/typescript-checker
```

**Step 2: Verify installation**

Run: `bun install --frozen-lockfile`
Expected: exits 0, no errors

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add stryker mutation testing dependencies"
```

---

### Task 2: Create Stryker configuration

**Files:**

- Create: `stryker.config.json`

**Step 1: Create the config file**

Create `stryker.config.json` at project root with:

```json
{
  "testRunner": "command",
  "commandRunner": {
    "command": "bun test tests/providers tests/tools tests/scripts tests/db tests/utils tests/schemas tests/*.test.ts"
  },
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.json",
  "mutate": [
    "src/providers/**/*.ts",
    "!src/providers/**/index.ts",
    "!src/providers/**/constants.ts",
    "!src/providers/types.ts",
    "src/tools/**/*.ts",
    "!src/tools/index.ts",
    "src/errors.ts",
    "src/config.ts",
    "src/memory.ts",
    "src/users.ts"
  ],
  "coverageAnalysis": "off",
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json",
  "concurrency": 4,
  "timeoutMS": 10000,
  "timeoutFactor": 2,
  "thresholds": {
    "high": 80,
    "low": 60,
    "break": null
  },
  "reporters": ["clear-text", "html", "json"],
  "htmlReporter": {
    "fileName": "reports/mutation.html"
  },
  "jsonReporter": {
    "fileName": "reports/mutation.json"
  },
  "ignorePatterns": ["tests", "node_modules", ".stryker-tmp"],
  "cleanTempDir": true
}
```

**Step 2: Commit**

```bash
git add stryker.config.json
git commit -m "chore: add stryker mutation testing configuration"
```

---

### Task 3: Add npm scripts

**Files:**

- Modify: `package.json` (scripts section)

**Step 1: Add three scripts to `package.json`**

Add these entries to the `"scripts"` object, after the existing `test:e2e:watch` entry:

```json
"test:mutate": "stryker run",
"test:mutate:changed": "stryker run --incremental",
"test:mutate:full": "stryker run --force"
```

**Step 2: Verify the script resolves**

Run: `bun run test:mutate --help`
Expected: Stryker help output (confirms the binary is found)

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add mutation testing scripts"
```

---

### Task 4: Update .gitignore

**Files:**

- Modify: `.gitignore`

**Step 1: Add Stryker entries to `.gitignore`**

Append to the end of `.gitignore`:

```
# mutation testing
.stryker-tmp/
reports/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore stryker temp dir and reports"
```

---

### Task 5: Update knip configuration

**Files:**

- Modify: `knip.jsonc`

Knip runs in strict mode and will flag `@stryker-mutator/typescript-checker` as an unused devDependency since it's loaded as a plugin by Stryker at runtime (not imported in code). It also needs to know about `stryker.config.json`.

**Step 1: Add Stryker plugin to knip config**

Add an `"ignoreDependencies"` array to `knip.jsonc` to whitelist the Stryker checker plugin:

```jsonc
"ignoreDependencies": ["@stryker-mutator/typescript-checker"]
```

This goes at the top level of the JSON object, after `"entry"`.

**Step 2: Verify knip passes**

Run: `bun run knip`
Expected: exits 0, no errors about stryker packages

**Step 3: Commit**

```bash
git add knip.jsonc
git commit -m "chore: whitelist stryker checker plugin in knip config"
```

---

### Task 6: Add CI workflow job

**Files:**

- Modify: `.github/workflows/ci.yml`

**Step 1: Add the mutation-testing job**

Append this job at the end of the `jobs:` section in `.github/workflows/ci.yml` (after the `e2e` job):

```yaml
mutation-testing:
  name: Mutation Testing
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: latest
    - name: Install dependencies
      run: bun install --frozen-lockfile
    - name: Restore Stryker incremental cache
      uses: actions/cache@v4
      with:
        path: reports/stryker-incremental.json
        key: stryker-incremental-${{ github.base_ref }}-${{ github.sha }}
        restore-keys: |
          stryker-incremental-${{ github.base_ref }}-
          stryker-incremental-master-
    - name: Run mutation testing
      run: bun run test:mutate
    - name: Upload mutation report
      uses: actions/upload-artifact@v4
      if: always()
      with:
        name: mutation-report
        path: reports/mutation.html
        retention-days: 14
```

**Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: exits 0 (no syntax errors)

If python3/yaml not available, skip this step — CI will validate on push.

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add mutation testing job with incremental cache"
```

---

### Task 7: Run baseline and verify

**Step 1: Run full mutation test to establish baseline**

Run:

```bash
bun run test:mutate:full
```

Expected: Stryker runs, produces clear-text output with mutation score, creates `reports/mutation.html` and `reports/mutation.json`. This may take several minutes depending on mutant count.

**Step 2: Record the baseline score**

Note the mutation score percentage from the output (e.g., "Mutation score: 72.5%"). This will be used in Phase 2 to set `thresholds.break`.

**Step 3: Verify reports exist**

Run:

```bash
ls -la reports/mutation.html reports/mutation.json reports/stryker-incremental.json
```

Expected: all three files exist

**Step 4: Verify incremental mode works**

Run:

```bash
bun run test:mutate
```

Expected: Stryker reuses cached results, completes significantly faster than the full run. Output should show "x mutant results reused".

---

### Task 8: Squash into single commit (optional)

If the implementer prefers a clean history, squash Tasks 1-6 into a single commit:

```bash
git rebase -i HEAD~6
```

Suggested message:

```
feat: add StrykerJS mutation testing with command runner

- Install @stryker-mutator/core and typescript-checker
- Configure command runner with bun test
- Target providers/, tools/, and core business logic files
- Add incremental caching for fast re-runs
- Add CI job with artifact upload and cache
- Add test:mutate, test:mutate:changed, test:mutate:full scripts
```

This task is optional — skip if you prefer granular commits.
