# Fix E2E Test Failures - Design Document

**Date:** 2026-03-13
**Approach:** Hybrid (Fix source code + Update tests + Improve infrastructure)

## Problem Summary

E2E tests revealed 24 failures out of 47 tests. Analysis shows three categories of issues:

1. **Implementation Bugs** (Source code needs fixing)
   - Column API using incorrect endpoints
   - Comment retrieval filtering issues
   - API returning 400/409 errors for valid operations

2. **Test Expectation Issues** (Tests need updating)
   - Error handling tests missing `await`
   - Column tests using default column names causing conflicts
   - Task relations error test expecting wrong behavior

3. **Infrastructure Issues** (Test harness needs improvement)
   - Docker startup timeouts (5000ms insufficient)
   - BeforeEach hook failures
   - Intermittent container startup failures

## Solution Design

### Phase 1: Fix Source Code Bugs

#### Column API Fixes

**File:** `src/kaneo/column-resource.ts`

**Issues Found:**

- Line 19: `GET /column/${projectId}` - Check if this is the correct endpoint
- Line 42: `POST /column/${projectId}` - Returns 409 for duplicate names
- Line 73: `GET /column/${columnId}` - Returns 400 error
- Line 100: `DELETE /column/${columnId}` - Returns 400 error

**Fixes:**

1. Verify and correct API endpoint URLs
2. Handle 409 conflicts gracefully (column already exists)
3. Fix GET/DELETE endpoints to use correct resource paths

#### Comment Retrieval Fixes

**File:** `src/kaneo/comment-resource.ts` or `src/kaneo/get-comments.ts`

**Issue:** Comments created but not retrieved
**Fix:** Check if comment filtering by type is correct (comments vs activities)

### Phase 2: Update Test Files

#### Error Handling Tests

**File:** `tests/e2e/error-handling.test.ts`

**Changes:**

- Line 32: Add `await` before `expect(promise).rejects.toThrow()`
- Line 42: Add `await` before `expect(promise).rejects.toThrow()`
- Verify error types match actual API behavior

#### Column Management Tests

**File:** `tests/e2e/column-management.test.ts`

**Changes:**

- Use unique column names (avoid "To Do", "In Progress", "Done")
- Add suffix with timestamp: `To Do ${Date.now()}`
- Handle 409 conflicts in test assertions if needed

#### Task Relations Tests

**File:** `tests/e2e/task-relations.test.ts`

**Changes:**

- Verify error type for non-existent task relation
- May need to adjust expected error class

### Phase 3: Infrastructure Improvements

#### Docker Startup Timeout

**File:** `tests/e2e/setup.ts`

**Changes:**

- Increase `beforeEach` timeout from 5000ms to 10000ms
- Add retry logic for Docker startup
- Improve error messages for startup failures

#### Test Isolation

**File:** `tests/e2e/kaneo-test-client.ts`

**Changes:**

- Ensure all resources are cleaned up properly
- Add retry for cleanup operations
- Better logging of cleanup failures

## Test Categories

### Tests That Should Pass After Fixes

| Test File                 | Expected Status | Reason                      |
| ------------------------- | --------------- | --------------------------- |
| task-lifecycle.test.ts    | ✅ Pass         | Already working             |
| task-archive.test.ts      | ✅ Pass         | Archive functionality works |
| task-search.test.ts       | ✅ Pass         | Search API working          |
| label-operations.test.ts  | ✅ Pass         | Labels working well         |
| label-management.test.ts  | ✅ Pass         | Label CRUD working          |
| project-lifecycle.test.ts | ✅ Pass         | Projects working            |
| project-archive.test.ts   | ✅ Pass         | Project archive works       |

### Tests Needing Source Code Fixes

| Test File                 | Issue             | Fix Location        |
| ------------------------- | ----------------- | ------------------- |
| column-management.test.ts | 409/400 errors    | column-resource.ts  |
| task-comments.test.ts     | Comment retrieval | comment-resource.ts |
| task-relations.test.ts    | Validation errors | task-relations.ts   |

### Tests Needing Test Updates

| Test File                 | Issue                           | Fix Location              |
| ------------------------- | ------------------------------- | ------------------------- |
| error-handling.test.ts    | Missing await                   | error-handling.test.ts    |
| column-management.test.ts | Default column names            | column-management.test.ts |
| user-workflows.test.ts    | Dependencies on broken features | Fix dependencies first    |

## Success Criteria

1. **Lint:** `bun run lint` passes with 0 errors
2. **Column Tests:** All column CRUD operations pass
3. **Comment Tests:** Comments can be added and retrieved
4. **Relations Tests:** Task relations work correctly
5. **Error Tests:** Error handling tests pass
6. **Overall:** >80% of tests passing (38+ out of 47)

## Implementation Order

1. Fix column-resource.ts API endpoints
2. Fix comment retrieval logic
3. Update error-handling.test.ts (add await)
4. Update column-management.test.ts (unique names)
5. Increase Docker timeouts
6. Run full E2E suite
7. Fix any remaining issues

## Risks

- **Low:** Column API endpoint discovery - may need API documentation
- **Medium:** Comment/activity distinction - may require schema changes
- **Low:** Docker timing - well-understood issue with standard fix

## Approval

This design addresses all identified failure categories through a hybrid approach:

- Fix implementation bugs (source code)
- Correct test expectations (test files)
- Improve reliability (infrastructure)

Ready to proceed with implementation planning.
