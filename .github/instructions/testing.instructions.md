---
applyTo: 'tests/**'
---

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

## Mock Pollution Prevention

`mock.module()` is global and permanent for the Bun process. This is the #1 source of false test failures.

1. **Check before mocking:** `grep -r "from.*src/foo.js" tests/ --include="*.test.ts" -l` — if other files import it unmocked, your mock will break them
2. **Mock the narrowest dependency:** Prefer mocking `db/drizzle.js` over `config.js` or `cache.js`
3. **Always clean up:** Add `afterAll(() => { mock.restore() })` if mocking modules used by other test files
4. **Verify full suite:** Run `bun test` (not just `bun test tests/your-file.test.ts`) to catch pollution
5. **Run checker:** `bun run mock-pollution` after adding new mocks

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

## Error Assertions

```typescript
const promise = getToolExecutor(tool)({ taskId: 'x' }, { toolCallId: '1', messages: [] })
await expect(promise).rejects.toThrow('Expected message')
```
