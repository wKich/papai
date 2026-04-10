# Testing Conventions

Runtime: **Bun** test runner (`bun:test`). No Jest, no Vitest.

## Test Helpers (use these, don't reinvent)

| Helper                 | Location                       | Purpose                                                |
| ---------------------- | ------------------------------ | ------------------------------------------------------ |
| `mockLogger()`         | `tests/utils/test-helpers.ts`  | Stubs pino logger globally                             |
| `mockDrizzle()`        | `tests/utils/test-helpers.ts`  | Stubs `getDrizzleDb` for in-memory SQLite              |
| `setupTestDb()`        | `tests/utils/test-helpers.ts`  | Creates in-memory SQLite with all migrations           |
| `createMockReply()`    | `tests/utils/test-helpers.ts`  | Captures `reply.text()` calls for assertions           |
| `createDmMessage()`    | `tests/utils/test-helpers.ts`  | Factory for DM `IncomingMessage`                       |
| `createGroupMessage()` | `tests/utils/test-helpers.ts`  | Factory for group `IncomingMessage`                    |
| `createAuth()`         | `tests/utils/test-helpers.ts`  | Factory for `AuthorizationResult`                      |
| `createMockChat()`     | `tests/utils/test-helpers.ts`  | Mock `ChatProvider` capturing command registrations    |
| `mockMessageCache()`   | `tests/utils/test-helpers.ts`  | Test-local message cache (isolated from production)    |
| `createMockProvider()` | `tests/tools/mock-provider.ts` | Fully-stubbed `TaskProvider` with overridable methods  |
| `createMockTask()`     | `tests/test-helpers.ts`        | Factory for `Task` with `Partial<Task>` overrides      |
| `createMockProject()`  | `tests/test-helpers.ts`        | Factory for `Project` with overrides                   |
| `createMockLabel()`    | `tests/test-helpers.ts`        | Factory for `Label` with overrides                     |
| `createMockColumn()`   | `tests/test-helpers.ts`        | Factory for status column with overrides               |
| `schemaValidates()`    | `tests/test-helpers.ts`        | Tests tool input schemas accept/reject given data      |
| `getToolExecutor()`    | `tests/test-helpers.ts`        | Extracts tool `execute` function                       |
| `setMockFetch()`       | `tests/test-helpers.ts`        | Global fetch mock for provider API tests               |
| `restoreFetch()`       | `tests/test-helpers.ts`        | Restores original `globalThis.fetch`                   |
| `expectAppError()`     | `tests/utils/test-helpers.ts`  | Asserts error is `AppError` with expected user message |

## Mocking Rules

- **Prefer dependency injection over `mock.module()`** — most modules now export a `Deps` interface and accept an optional `deps` parameter with production defaults
- NEVER mock `globalThis.fetch` directly — use `setMockFetch()` / `restoreFetch()` from `tests/test-helpers.ts`
- NEVER use `spyOn().mockImplementation()` for module mocks — use DI or mutable `let impl` pattern
- Use `mock()` from `bun:test` for spy functions
- `mock.module()` is still required for: `ai`, `@ai-sdk/openai-compatible`, `logger`, and a few provider modules in `llm-orchestrator.test.ts`

### Dependency Injection Pattern (preferred)

Many source modules export a `Deps` interface and accept an optional `deps` parameter:

```typescript
// Source module (src/tools/completion-hook.ts)
export interface CompletionHookDeps {
  findTemplateByTaskId: (taskId: string) => RecurringTaskRecord | null
  isCompletionStatus: (status: string) => boolean
}
const defaultDeps: CompletionHookDeps = { /* real implementations */ }
export const completionHook = async (taskId, status, provider, deps = defaultDeps) => { ... }
```

Tests pass fakes directly — no `mock.module()` needed:

```typescript
const deps: CompletionHookDeps = {
  findTemplateByTaskId: (): RecurringTaskRecord | null => template,
  isCompletionStatus: (s: string): boolean => s === 'done',
}
await completionHook('task-1', 'done', provider, deps)
```

### Mutable Implementation Pattern (legacy, for modules without DI)

```typescript
import { mock } from 'bun:test'

type GenerateTextResult = { output: { keep_indices: number[]; summary: string } }
let generateTextImpl = (): Promise<GenerateTextResult> =>
  Promise.resolve({ output: { keep_indices: [0, 1], summary: 'Summary' } })

void mock.module('ai', () => ({
  generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
}))

// Now import code under test
import { functionUnderTest } from '../src/module.js'
```

Override per-test by reassigning `generateTextImpl`.

## Mock Pollution Prevention

`mock.module()` is global and permanent in Bun. The preload `tests/mock-reset.ts`
restores real modules before every test via a global `beforeEach`.

### Rules

1. **Never call `mock.module()` at file top-level** — always inside `describe`-level `beforeEach`
2. **Never call `mockLogger()` / `mockDrizzle()` / `mockMessageCache()` at file top-level** — same rule
3. **No `afterAll(() => { mock.restore() })` needed** — global `afterEach` handles it
4. **Adding a new mocked module?** Add it to `tests/mock-reset.ts` originals list
5. **Mutable `let impl` pattern** — declare inside `describe`, reset in `beforeEach`

### Template for new test files

```typescript
import { describe, expect, test, beforeEach } from 'bun:test'
import type { SomeDeps } from '../src/module.js'
import { functionUnderTest } from '../src/module.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('Module', () => {
  let deps: SomeDeps

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    deps = {
      dependency: (): ReturnType => fakeValue,
    }
  })

  test('does something', () => {
    const result = functionUnderTest(input, deps)
    expect(result).toBe(expected)
  })
})
```

### Checklist for new test files

- [ ] Prefer DI (`deps` parameter) over `mock.module()` where available
- [ ] `mock.module()` and helpers called in `beforeEach` (NOT top-level)
- [ ] Mutable `let impl` declared inside `describe`
- [ ] No `afterAll(() => { mock.restore() })` present
- [ ] If mocking a NEW module not in `mock-reset.ts`, add it there
- [ ] `bun test` (full suite) passes
- [ ] `bun test --randomize` passes

## Test Structure

```typescript
describe('Feature', () => {
  beforeEach(() => {
    mock.restore()
  })

  describe('specificFunction', () => {
    test('returns expected result', async () => { ... })
    test('validates required parameters', () => { ... })
    test('propagates API errors', async () => { ... })
  })
})
```

## Schema Validation Testing

```typescript
expect(schemaValidates(tool, {})).toBe(false) // missing required fields
expect(schemaValidates(tool, { taskId: 'x' })).toBe(true) // valid input
```

## E2E Testing

E2E tests run against a real Kaneo instance in Docker. Global setup is handled by `bun-test-setup.ts`.

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'

describe('Feature', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()
  })

  test('does something', async () => {
    const project = await testClient.createTestProject()
    const task = await createTask(kaneoConfig, { title: 'Test', projectId: project.id })
    testClient.trackTask(task.id)
  })
})
```

- Use `KaneoTestClient` for resource management
- **Always** call `testClient.trackTask(taskId)` for tasks created outside the test client
- Clean up in `beforeEach` — not `afterEach`
- No `beforeAll`/`afterAll` needed — Docker lifecycle is global
- Do NOT mock anything in E2E tests
- Run with `bun test:e2e` (excluded from `bun test`)
- Before writing a new E2E plan, read `docs/superpowers/e2e-planning-workflow.md`.
- Start new E2E plan docs from `docs/superpowers/templates/e2e-test-plan-template.md`.
- The current Docker-backed Kaneo harness maps to **Tier 1: Provider-Real E2E**.
- Escalate to Tier 2-4 only when the scenario depends on runtime, platform, or operational boundaries that Tier 1 cannot prove.
