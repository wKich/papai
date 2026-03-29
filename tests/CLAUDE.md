# Testing Conventions

Runtime: **Bun** test runner (`bun:test`). No Jest, no Vitest.

## Test Helpers (use these, don't reinvent)

| Helper | Location | Purpose |
|--------|----------|---------|
| `mockLogger()` | `tests/utils/test-helpers.ts` | Stubs pino logger globally |
| `mockDrizzle()` | `tests/utils/test-helpers.ts` | Stubs `getDrizzleDb` for in-memory SQLite |
| `setupTestDb()` | `tests/utils/test-helpers.ts` | Creates in-memory SQLite with all migrations |
| `createMockReply()` | `tests/utils/test-helpers.ts` | Captures `reply.text()` calls for assertions |
| `createDmMessage()` | `tests/utils/test-helpers.ts` | Factory for DM `IncomingMessage` |
| `createGroupMessage()` | `tests/utils/test-helpers.ts` | Factory for group `IncomingMessage` |
| `createAuth()` | `tests/utils/test-helpers.ts` | Factory for `AuthorizationResult` |
| `createMockChat()` | `tests/utils/test-helpers.ts` | Mock `ChatProvider` capturing command registrations |
| `mockMessageCache()` | `tests/utils/test-helpers.ts` | Test-local message cache (isolated from production) |
| `createMockProvider()` | `tests/tools/mock-provider.ts` | Fully-stubbed `TaskProvider` with overridable methods |
| `createMockTask()` | `tests/test-helpers.ts` | Factory for `Task` with `Partial<Task>` overrides |
| `createMockProject()` | `tests/test-helpers.ts` | Factory for `Project` with overrides |
| `createMockLabel()` | `tests/test-helpers.ts` | Factory for `Label` with overrides |
| `createMockColumn()` | `tests/test-helpers.ts` | Factory for status column with overrides |
| `schemaValidates()` | `tests/test-helpers.ts` | Tests tool input schemas accept/reject given data |
| `getToolExecutor()` | `tests/test-helpers.ts` | Extracts tool `execute` function |
| `setMockFetch()` | `tests/test-helpers.ts` | Global fetch mock for provider API tests |
| `restoreFetch()` | `tests/test-helpers.ts` | Restores original `globalThis.fetch` |
| `expectAppError()` | `tests/utils/test-helpers.ts` | Asserts error is `AppError` with expected user message |

## Mocking Rules

- NEVER mock `globalThis.fetch` directly — use `setMockFetch()` / `restoreFetch()` from `tests/test-helpers.ts`
- NEVER use `spyOn().mockImplementation()` for module mocks — use mutable `let impl` pattern
- Use `mock()` from `bun:test` for spy functions
- Register mocks BEFORE importing code under test

### Mutable Implementation Pattern

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

## Mock Pollution Prevention (HIGH PRIORITY)

`mock.module()` is global and permanent for the Bun process. This is the #1 source of false test failures.

### Rules

1. **Check before mocking:** `grep -r "from.*src/foo.js" tests/ --include="*.test.ts" -l` — if other files import it unmocked, your mock will break them
2. **Mock the narrowest dependency:** Prefer mocking `db/drizzle.js` over `config.js` or `cache.js`
3. **Always clean up:** Add `afterAll(() => { mock.restore() })` if mocking modules used by other test files. `mock.restore()` restores **all** mocked modules — call in `afterAll`, not `afterEach`
4. **Prefer test helpers:** Check `tests/utils/test-helpers.ts` and `tests/tools/mock-provider.ts` before writing new `mock.module()` calls
5. **Self-contained heavy mockers:** Files mocking 4+ modules must add `afterAll(() => { mock.restore() })` and document mocked modules at top of file
6. **Beware transitive pollution:** Mocking `src/db/drizzle.js` affects any file that transitively imports it. Run `bun run mock-pollution` after adding new mocks
7. **Verify full suite:** Run `bun test` (not just `bun test tests/your-file.test.ts`)

### Checklist for new test files

- [ ] Mocks registered **before** imports of code under test
- [ ] Only directly needed modules are mocked
- [ ] `mock.restore()` in `afterAll` if mocking shared modules
- [ ] `bun test` (full suite) passes
- [ ] Mutable `let impl` pattern used (not inline return values)

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
expect(schemaValidates(tool, {})).toBe(false)           // missing required fields
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
