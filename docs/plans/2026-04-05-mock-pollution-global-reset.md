# Global Mock Reset via Preload

**Status:** Ready for implementation
**Goal:** Eliminate mock pollution from `mock.module()` so tests pass under `bun test --randomize`.

---

## Problem

Bun's `mock.module()` is process-global and permanent. `mock.restore()` does not
reset module mocks (confirmed in Bun docs and GitHub issues #7823, #12823). Since
Bun runs all test files in a single process, mocks leak between files. Test
execution order determines pass/fail.

Current state: 41 test files, 61 `mock.module()` invocations, 14 unique modules
mocked. All `afterAll(() => { mock.restore() })` calls are ineffective for module
mocks.

## Mechanism

`mock.module()` updates ES module live bindings even for already-imported modules.
This means it can be called in `beforeEach` (after imports) and the updated exports
propagate to all importers transitively.

### Strategy

1. A **preload script** (`tests/mock-reset.ts`) captures real exports of all
   commonly-mocked modules at startup, before any test file loads.
2. A **global `beforeEach`** re-applies originals via `mock.module()` -- every test
   starts with real modules.
3. Each **test file** re-applies its mocks in `describe`-level `beforeEach`,
   overriding the global reset.
4. A **global `afterEach`** calls `mock.restore()` to reset spies.

### Flow per test

```
global beforeEach -> restore all originals via mock.module()
  |
file-level beforeEach -> re-apply this file's specific mocks
  |
test runs (sees only its own mocks)
  |
global afterEach -> mock.restore() (spies only)
```

## Modules to capture

| Module                                | Mocked in N files | Side effects on import |
| ------------------------------------- | ----------------- | ---------------------- |
| `src/db/drizzle.js`                   | 16                | No (lazy)              |
| `ai`                                  | 5                 | No                     |
| `@ai-sdk/openai-compatible`           | 5                 | No                     |
| `src/db/index.js`                     | 4                 | No                     |
| `src/logger.js`                       | 4                 | No (LOG_LEVEL=silent)  |
| `src/message-cache/cache.js`          | 2                 | No                     |
| `src/providers/kaneo/provision.js`    | 2                 | No                     |
| `src/providers/kaneo/list-columns.js` | 2                 | No                     |
| `src/recurring.js`                    | 2                 | No                     |
| `src/scheduler.js`                    | 1                 | No                     |
| `src/providers/registry.js`           | 1                 | No                     |
| `src/providers/factory.js`            | 1                 | No                     |
| `src/changelog-reader.js`             | 1                 | No                     |
| `src/llm-orchestrator.js`             | 1                 | No                     |

## Caveat: lazy consumption required

This only works if mocked modules are consumed lazily (inside functions), not
captured at module load time:

```typescript
// OK -- lazy, live bindings work
import { getDrizzleDb } from './db/drizzle.js'
export function getConfig() {
  const db = getDrizzleDb() // resolved at call time
}

// BROKEN -- captured at load time, beforeEach too late
import { getDrizzleDb } from './db/drizzle.js'
const db = getDrizzleDb() // resolved once at import time
```

The current codebase uses lazy patterns consistently.

## Implementation

### 1. New file: `tests/mock-reset.ts`

Captures real module exports at preload time and registers global hooks.

- Import all 14 commonly-mocked modules
- Store their exports in an array of `[path, exports]` tuples
- `beforeEach`: iterate and re-apply originals via `mock.module()`
- `afterEach`: call `mock.restore()` for spies

### 2. Update `bunfig.toml`

Add `./tests/mock-reset.ts` to the preload array after `./tests/setup.ts`.

### 3. Refactor each test file (41 files)

For each file that calls `mock.module()` at the top level:

- Move `mock.module()` into `describe`-level `beforeEach`
- Reset mutable `let impl` variables to defaults in `beforeEach`
- Remove `afterAll(() => { mock.restore() })` -- global handles it
- Move imports to the top of the file (no longer need to follow mock registration)

### 4. Update test helpers

`mockDrizzle()`, `mockLogger()`, `mockMessageCache()` become functions designed
to be called inside `beforeEach` rather than at file top level.

### 5. Validation

Run `bun test --randomize` to confirm order-independence.

## Relationship to DI refactor

This design is a safety net. The long-term plan (see
`2026-04-05-dependency-injection-test-refactor.md`) incrementally eliminates
`mock.module()` via dependency injection. As each module is migrated to DI, it
is removed from the `tests/mock-reset.ts` originals list. When all modules are
migrated, `mock-reset.ts` can be deleted.
