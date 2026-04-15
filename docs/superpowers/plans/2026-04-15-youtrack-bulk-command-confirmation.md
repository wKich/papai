# YouTrack Bulk Command Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apply_youtrack_command` always require confirmation when it targets more than one issue, even if the command text is otherwise allowlisted.

**Architecture:** Keep the change local to the tool-layer confirmation policy in `src/tools/apply-youtrack-command.ts`. Extend the existing tool-local confirmation gate to treat multi-issue scope as confirmation-required, then lock the behavior in with focused regression tests in `tests/tools/youtrack-command.test.ts`.

**Tech Stack:** Bun, TypeScript, Bun test runner (`bun:test`), Zod, Vercel AI SDK tool definitions

---

### Task 1: Add Failing Bulk Confirmation Tests

**Files:**
- Modify: `tests/tools/youtrack-command.test.ts`
- Implementation reference: `src/tools/apply-youtrack-command.ts`

- [ ] **Step 1: Write the failing tests**

Append these tests inside `describe('apply_youtrack_command', ...)` in `tests/tools/youtrack-command.test.ts`:

```ts
  test('requires confirmation when an allowlisted command targets multiple issues', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'for me',
      taskIds: ['TEST-1', 'TEST-2'],
      confidence: 0.6,
    })

    expectConfirmationMessage(result, 'to 2 issue(s)')
    expect(applyCommand).not.toHaveBeenCalled()
  })

  test('forwards a confirmed allowlisted command that targets multiple issues', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'] }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

    const result = await getToolExecutor(tool)({
      query: 'for me',
      taskIds: ['TEST-1', 'TEST-2'],
      confidence: 1,
    })

    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'] })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for me',
      taskIds: ['TEST-1', 'TEST-2'],
      comment: undefined,
      silent: undefined,
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/tools/youtrack-command.test.ts
```

Expected: FAIL because the current implementation still lets allowlisted commands run immediately when `taskIds.length > 1`.

- [ ] **Step 3: Commit the failing test state only if your workflow requires it**

Do not commit red-state tests unless your execution workflow explicitly requires red commits. Otherwise continue directly to implementation.

### Task 2: Implement Bulk Confirmation Gate

**Files:**
- Modify: `src/tools/apply-youtrack-command.ts`
- Test: `tests/tools/youtrack-command.test.ts`

- [ ] **Step 1: Update the tool-local confirmation gate**

Change the local helper signature and rule set in `src/tools/apply-youtrack-command.ts` from:

```ts
const requiresConfirmation = (query: string, comment: string | undefined, silent: boolean | undefined): boolean => {
  if (comment !== undefined || silent === true) return true
  const normalizedQuery = normalizeCommand(query)
  return !SAFE_COMMANDS.has(normalizedQuery) && !SINGLE_ASSIGNEE_COMMAND.test(normalizedQuery)
}
```

to:

```ts
const requiresConfirmation = (
  query: string,
  taskIds: readonly string[],
  comment: string | undefined,
  silent: boolean | undefined,
): boolean => {
  if (taskIds.length > 1 || comment !== undefined || silent === true) return true
  const normalizedQuery = normalizeCommand(query)
  return !SAFE_COMMANDS.has(normalizedQuery) && !SINGLE_ASSIGNEE_COMMAND.test(normalizedQuery)
}
```

- [ ] **Step 2: Pass `taskIds` into the confirmation check**

Update the execute path from:

```ts
      if (requiresConfirmation(query, comment, silent)) {
```

to:

```ts
      if (requiresConfirmation(query, taskIds, comment, silent)) {
```

- [ ] **Step 3: Run the focused test file to verify it passes**

Run:

```bash
bun test tests/tools/youtrack-command.test.ts
```

Expected: PASS with the new multi-issue tests green and the existing single-issue regression tests still green.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/tools/apply-youtrack-command.ts tests/tools/youtrack-command.test.ts
git commit -m "fix: require confirmation for bulk youtrack commands"
```

### Task 3: Run Focused Verification

**Files:**
- Verify only; no new files expected

- [ ] **Step 1: Run the focused command-related verification suite**

Run:

```bash
bun test tests/tools/youtrack-command.test.ts tests/providers/youtrack/operations/commands.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: PASS. This verifies the tool behavior change did not break provider command transport or YouTrack tool exposure.

- [ ] **Step 2: Run the broader YouTrack regression suite already used for this branch**

Run:

```bash
bun test tests/tools/agile-tools.test.ts tests/tools/task-history-tools.test.ts tests/tools/saved-query-tools.test.ts tests/tools/youtrack-command.test.ts tests/tools/create-task.test.ts tests/tools/update-task.test.ts tests/tools/get-task.test.ts tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/operations/agiles.test.ts tests/providers/youtrack/operations/activities.test.ts tests/providers/youtrack/operations/saved-queries.test.ts tests/providers/youtrack/operations/commands.test.ts tests/providers/youtrack/operations/tasks.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit verification-related updates only if additional code changes were required**

If verification required no further edits, do not create an extra commit. If you had to change code after running the broader suite, commit those follow-up fixes with a focused message.

## Plan Self-Review

Spec coverage check:

- Bulk confirmation requirement: covered in Task 1 and Task 2.
- Preserve single-issue allowlisted behavior: covered by keeping existing regression tests green in Task 2 Step 3.
- Confirmation message includes bulk scope: covered by Task 1 Step 1 via `expectConfirmationMessage(result, 'to 2 issue(s)')`.
- No provider-layer contract change: respected by keeping provider files out of scope and verifying with Task 3 Step 1.

Placeholder scan:

- No `TODO`, `TBD`, or vague “add tests” steps remain.
- All code-edit steps include exact code snippets or exact replacement targets.

Type consistency check:

- `requiresConfirmation(...)` uses `readonly string[]` for `taskIds`, which matches the existing call site usage and avoids introducing mutation.
- Commit message, file paths, and test commands all match the current codebase paths.

## Notes For Implementers

- Do not broaden the scope into provider-layer changes.
- Do not change the shared `checkConfidence(...)` threshold or message shape.
- Do not add new confirmation UX or new commands.
- Keep the change minimal and local to the tool policy and its focused regression tests.
