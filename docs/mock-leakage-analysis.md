# E2E Test Isolation Issue: Mock Leakage Analysis

## Problem Summary

When running all tests together (`bun test`), E2E tests fail due to mock leakage from unit tests. The mock in `tests/tools/project-tools.test.ts` persists and affects E2E test execution.

## Root Cause

### Mock Registration (tests/tools/project-tools.test.ts:187-189)

```typescript
test('propagates API errors', async () => {
  await mock.module('../../src/kaneo/index.js', () => ({
    createProject: mock(() => Promise.reject(new Error('API Error'))),
  }))
  // ... test continues
})
```

### Mock Consumption (tests/e2e/kaneo-test-client.ts:34)

```typescript
async createTestProject(name?: string): Promise<{ id: string; name: string; slug: string }> {
  const projectName = name ?? `Test Project ${generateUniqueSuffix()}`
  const project = await createProject({  // <-- Gets mocked version
    config: this.kaneoConfig,
    workspaceId: this.config.workspaceId,
    name: projectName,
  })
  // ...
}
```

## Why Mocks Leak

1. **Bun's `mock.module()` mocks are global to the test process**
   - Unlike Jest's `jest.mock()` which can be isolated per test file
   - Bun's mock.module() replaces the module in the module cache globally

2. **E2E tests run after unit tests in the same process**
   - Bun test runner loads all test files in the same process
   - Execution order: unit tests first, then E2E tests

3. **No mock restoration between test files**
   - The mock is never reset after the unit test completes
   - All subsequent imports of `../../src/kaneo/index.js` get the mocked version

## Evidence

### Test Run Output (bun test)

```
error: API Error
      at <anonymous> (/Users/ki/Projects/experiments/papai/tests/tools/project-tools.test.ts:188:54)
      at createTestProject (/Users/ki/Projects/experiments/papai/tests/e2e/kaneo-test-client.ts:34:27)
      at <anonymous> (/Users/ki/Projects/experiments/papai/tests/e2e/user-workflows.test.ts:53:38)
(fail) E2E: User Workflows > full task lifecycle workflow [0.03ms]
```

The stack trace clearly shows:

1. Mock is set at `project-tools.test.ts:188`
2. E2E test calls `createTestProject()` at `kaneo-test-client.ts:34`
3. Which calls the mocked `createProject`
4. Which throws 'API Error' from the mock

### When Run Alone, E2E Tests Pass

```bash
bun test --preload ./tests/e2e/bun-test-setup.ts tests/e2e/e2e.test.ts
# All E2E tests pass
```

## Impact

- **508 tests pass, 70 fail** when running `bun test`
- All 70 failures are E2E tests that depend on `createTestProject()`
- Unit tests pass because they run before the mock is applied

## Potential Solutions

1. **Restore mocks after each test file**
   - Use `afterAll()` to restore original module
   - Bun provides `mock.restore()` to reset all mocks

2. **Separate test runs**
   - Run unit tests and E2E tests separately
   - Update CI to run: `bun test tests/tools && bun run test:e2e`

3. **Avoid mock.module() in shared modules**
   - Use dependency injection instead
   - Pass mock functions as parameters rather than module-level mocking

4. **Use spyOn instead of module mock**
   - `spyOn()` is more targeted and can be restored per-test

## Recommendation

The most reliable fix is Solution #2 (separate test runs) combined with Solution #1 (mock restoration). This ensures:

- Unit tests can use mocks freely
- E2E tests always get real implementations
- No accidental coupling between test suites
