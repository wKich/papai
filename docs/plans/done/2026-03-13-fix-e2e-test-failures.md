# Fix E2E Test Failures Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all E2E test failures by correcting source code bugs, updating test expectations, and improving infrastructure.

**Architecture:** Hybrid approach fixing implementation bugs (column API, comments), updating test expectations (error handling, column names), and improving infrastructure (Docker timeouts).

**Tech Stack:** Bun, TypeScript, Docker, Kaneo API

---

## Task 1: Research Kaneo Column API Endpoints

**Files:**

- Research: Existing working code in `src/kaneo/`
- Check: `src/kaneo/column-resource.ts`
- Check: Other resource files for pattern comparison

**Step 1: Compare column-resource with working resources**

Look at how other resources structure their API calls:

```typescript
// Look at project-resource.ts, task-resource.ts, label-resource.ts
// Compare endpoint patterns
```

**Step 2: Identify the correct column API pattern**

Check if column endpoints should be:

- `/column/${projectId}` (current) or
- `/project/${projectId}/column` (alternative)

Also check if individual column operations should be:

- `/column/${columnId}` or
- `/project/${projectId}/column/${columnId}`

**Step 3: Document findings**

Note the correct endpoint patterns discovered.

**Step 4: Commit research notes**

```bash
git add -A
git commit -m "docs: research Kaneo column API endpoint patterns"
```

---

## Task 2: Fix Column Resource API Endpoints

**Files:**

- Modify: `src/kaneo/column-resource.ts:19,42,73,84,100`

**Step 1: Fix the list endpoint**

Current (line 19):

```typescript
;`/column/${projectId}`
```

Change to correct endpoint if different.

**Step 2: Fix the create endpoint**

Current (line 42):

```typescript
;`/column/${projectId}`
```

Verify this is correct or update.

**Step 3: Fix the GET endpoint for update**

Current (line 73):

```typescript
;`/column/${columnId}`
```

The test shows this returns 400. Check if it needs projectId.

**Step 4: Fix the DELETE endpoint**

Current (line 100):

```typescript
;`/column/${columnId}`
```

Update if needed.

**Step 5: Run typecheck**

Run: `bun run lint`
Expected: No errors

**Step 6: Commit**

```bash
git add src/kaneo/column-resource.ts
git commit -m "fix: correct column API endpoint URLs"
```

---

## Task 3: Fix Comment Resource Retrieval

**Files:**

- Modify: `src/kaneo/comment-resource.ts` (if exists) or `src/kaneo/get-comments.ts`
- Check: `src/kaneo/add-comment.ts` for comparison

**Step 1: Compare add vs get comment implementations**

Look at how `addComment` stores comments vs how `getComments` retrieves them.

**Step 2: Identify the retrieval issue**

The error shows: "Failed to retrieve created comment: no comments found"

This suggests comments are being filtered incorrectly or stored as wrong type.

**Step 3: Fix the filtering logic**

Update the comment retrieval to properly filter activities by comment type.

**Step 4: Run typecheck**

Run: `bun run lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/kaneo/comment-resource.ts
git commit -m "fix: correct comment retrieval filtering"
```

---

## Task 4: Update Error Handling Tests

**Files:**

- Modify: `tests/e2e/error-handling.test.ts:31-34,36-43`

**Step 1: Add await to first error test**

Line 31-34, change from:

```typescript
test('throws error for non-existent task', async () => {
  const promise = getTask({ config: kaneoConfig, taskId: 'non-existent-id' })
  expect(promise).rejects.toThrow()
})
```

To:

```typescript
test('throws error for non-existent task', async () => {
  const promise = getTask({ config: kaneoConfig, taskId: 'non-existent-id' })
  await expect(promise).rejects.toThrow()
})
```

**Step 2: Add await to second error test**

Line 36-43, add `await` before `expect`.

**Step 3: Run typecheck**

Run: `bun run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add tests/e2e/error-handling.test.ts
git commit -m "fix: add await to error handling test assertions"
```

---

## Task 5: Update Column Management Tests

**Files:**

- Modify: `tests/e2e/column-management.test.ts`

**Step 1: Make column names unique**

Change all column names to include timestamp to avoid conflicts with defaults:

```typescript
// Change from:
name: 'To Do'

// To:
name: `To Do ${Date.now()}`
```

Apply to all tests creating columns.

**Step 2: Update column name tests**

Line ~72, update test:

```typescript
const column = await createColumn({ config: kaneoConfig, projectId, name: `Old Name ${Date.now()}` })
```

**Step 3: Run typecheck**

Run: `bun run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add tests/e2e/column-management.test.ts
git commit -m "fix: use unique column names to avoid conflicts"
```

---

## Task 6: Increase Docker Startup Timeout

**Files:**

- Modify: `tests/e2e/setup.ts`

**Step 1: Find timeout configuration**

Look for test timeout settings in setup.ts.

**Step 2: Increase timeout**

Change from 5000ms to 10000ms:

```typescript
// Look for timeout settings and increase
```

**Step 3: Add retry logic if needed**

Consider adding simple retry for Docker startup.

**Step 4: Run typecheck**

Run: `bun run lint`
Expected: No errors

**Step 5: Commit**

```bash
git add tests/e2e/setup.ts
git commit -m "fix: increase Docker startup timeout"
```

---

## Task 7: Run E2E Tests and Verify Fixes

**Files:**

- All modified files

**Step 1: Run full E2E suite**

```bash
bun test tests/e2e 2>&1 | tee test-results.txt
```

**Step 2: Analyze results**

Count passing vs failing tests.

**Step 3: Identify remaining issues**

Note any tests still failing and their error messages.

**Step 4: Commit results**

```bash
git add test-results.txt
git commit -m "test: run E2E suite and capture results"
```

---

## Task 8: Fix Any Remaining Issues

**Files:**

- TBD based on test results

**Step 1: Review failing tests**

Check which tests are still failing.

**Step 2: Apply fixes**

Fix any remaining source code or test issues.

**Step 3: Run typecheck**

Run: `bun run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: address remaining E2E test failures"
```

---

## Task 9: Final Verification

**Files:**

- All E2E test files

**Step 1: Run lint**

Run: `bun run lint`
Expected: 0 errors

**Step 2: Run full E2E suite**

Run: `bun test tests/e2e`
Expected: >80% passing (38+ out of 47)

**Step 3: Verify success criteria**

- ✅ Lint passes
- ✅ Column tests pass
- ✅ Comment tests pass
- ✅ Relations tests pass
- ✅ Error tests pass
- ✅ Overall >80% pass rate

**Step 4: Final commit**

```bash
git commit -m "test: complete E2E test fixes - all criteria met" --allow-empty
```

---

## Summary

This plan addresses all E2E test failures through:

1. Fixing column API endpoint bugs (Task 2)
2. Fixing comment retrieval (Task 3)
3. Adding missing awaits to tests (Task 4)
4. Using unique column names (Task 5)
5. Improving Docker reliability (Task 6)
6. Iterative fixes for remaining issues (Task 8)

**Total Tasks:** 9
**Estimated Time:** 2-3 hours
**Success Metric:** >80% test pass rate

---

**Plan complete and saved to `docs/plans/2026-03-13-fix-e2e-test-failures.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
