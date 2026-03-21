# Mutation Testing with StrykerJS

**Date:** 2026-03-19  
**Status:** Approved  
**Approach:** Command Runner (Approach B)

## Goal

Add mutation testing as a quality gate in CI and a local developer tool, targeting critical business logic only.

## Approach Decision

**Command Runner** was chosen over:

- **Community Bun Runner Plugin** (`stryker-mutator-bun-runner` v0.4.0) — low adoption, single maintainer, pre-1.0 risk
- **Vitest Adapter Layer** — would require rewriting `bun:test` mock patterns across ~50 test files

The command runner shells out to `bun test`, works with any test runner, and requires zero test changes. The trade-off is `coverageAnalysis: "off"` (all tests run per mutant), which is acceptable given the narrow mutation scope and fast test suite (~600+ tests in <1s).

## Dependencies

```
@stryker-mutator/core                — Stryker engine
@stryker-mutator/typescript-checker  — filters compile-error mutants before testing
```

Both as devDependencies.

## Configuration

File: `stryker.config.json` at project root.

```json
{
  "testRunner": "command",
  "commandRunner": {
    "command": "bun test tests/providers tests/tools tests/db tests/utils tests/commands tests/*.test.ts"
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

Key decisions:

- `coverageAnalysis: "off"` — command runner cannot do `perTest`
- Excludes `index.ts` (re-exports), `constants.ts` (static values), `types.ts` (type-only)
- `incremental: true` — only re-mutates changed files
- TypeScript checker filters compile-error mutants before test execution
- `thresholds.break: null` initially — no enforcement until baseline is established
- **Test directories aligned with actual project structure** — includes `tests/commands/` which contains command handler tests

## NPM Scripts

```json
{
  "test:mutate": "stryker run",
  "test:mutate:changed": "stryker run --incremental",
  "test:mutate:full": "stryker run --force"
}
```

| Command                       | Purpose                      | When to use                     |
| ----------------------------- | ---------------------------- | ------------------------------- |
| `bun run test:mutate`         | Incremental run (default)    | Day-to-day local use            |
| `bun run test:mutate:changed` | Explicit incremental alias   | Clarity                         |
| `bun run test:mutate:full`    | Force full run, ignore cache | After major refactors, baseline |

## CI Integration

New job in `.github/workflows/ci.yml`:

```yaml
mutation-testing:
  name: Mutation Testing
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: 1.3.11
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

- Bun version aligned with existing CI jobs (`1.3.11`)
- Cache restores `stryker-incremental.json` from previous CI runs
- HTML report uploaded as artifact (14-day retention)
- No threshold enforcement initially

## .gitignore Additions

```
# mutation testing
.stryker-tmp/
reports/
```

CI manages its own incremental cache via `actions/cache`.

## Rollout Strategy

### Phase 1 — Baseline (immediate)

- Install dependencies, add config, run `bun run test:mutate:full`
- Record initial mutation score
- `thresholds.break: null` — informational only

### Phase 2 — Enforce

- Set `thresholds.break` to baseline minus 5 (e.g., baseline 72% -> break 67)
- CI blocks PRs that drop below threshold

### Phase 3 — Ratchet up (ongoing)

- Periodically raise `thresholds.break` toward 80%
- Review HTML reports to prioritize high-value surviving mutants
- Focus on: conditional boundary changes, removed method calls, negated conditions

### Noise reduction (if needed)

```json
{
  "mutator": {
    "excludedMutations": ["StringLiteral", "ObjectLiteral"]
  }
}
```

Add exclusions only if string/object literal mutations produce too much noise.

## Mutation Scope

- `src/providers/**/*.ts` (~67 files across kaneo/ and youtrack/, excluding index/constants/types)
- `src/tools/**/*.ts` (~30 files, excluding index)
- `src/errors.ts`, `src/config.ts`, `src/memory.ts`, `src/users.ts`

## Alignment Notes

- **Bun version**: Aligned to `1.3.11` to match existing CI jobs
- **Test directories**: Command updated to reflect actual project structure (added `tests/commands/`)
- **Provider coverage**: Includes both `kaneo/` and `youtrack/` subdirectories via `src/providers/**/*.ts`

## Sources

- [StrykerJS Configuration Reference](https://stryker-mutator.io/docs/stryker-js/configuration/)
- [StrykerJS TypeScript Checker](https://stryker-mutator.io/docs/stryker-js/typescript-checker/)
- [StrykerJS Incremental Mode](https://stryker-mutator.io/docs/stryker-js/incremental/)
- [StrykerJS Node.js Guide](https://stryker-mutator.io/docs/stryker-js/guides/nodejs/)
- [Bun Test Runner Support Issue #4439](https://github.com/stryker-mutator/stryker-js/issues/4439)
- [stryker-mutator-bun-runner](https://www.jsdelivr.com/package/npm/stryker-mutator-bun-runner) (evaluated, not chosen)
