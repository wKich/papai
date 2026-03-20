# Phase 02: Enhanced Tool Capabilities — Development Plan

**Created**: 2026-03-20  
**Scope**: User stories from `docs/user-stories/phase-02-enhanced-tool-capabilities.md`  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: Users can manage the full lifecycle of a task through natural language — adding comments, setting deadlines, applying labels, linking related tasks, creating projects, and archiving or deleting stale work — without ever leaving the chat interface.
- **Success Metrics**:
  - All 8 user stories pass their stated acceptance criteria against both the Kaneo and YouTrack providers
  - The LLM is never exposed to provider-specific internal terminology (no "frontmatter", no "Kaneo label") in tool descriptions
  - `update_task_relation` does not throw a runtime error for YouTrack users
  - Asking for "full task details" consistently triggers both `get_task` and `get_comments` without additional prompting
  - All destructive operations (archive, delete) require explicit confirmation and are blocked on low-confidence requests
- **Priority**: Medium — all core tools exist; work is stabilisation, correctness, and cross-provider parity
- **Timeline**: 3–4 days

---

## Current State Audit

All 8 user stories have corresponding tool files in `src/tools/`. The provider layer (Kaneo and YouTrack) is also substantially implemented. The outstanding work is a set of **correctness and cross-provider gaps** rather than net-new functionality.

### What is already in place

| User Story                       | Tools                                                               | Kaneo Provider          | YouTrack Provider           | Unit Tests                                           |
| -------------------------------- | ------------------------------------------------------------------- | ----------------------- | --------------------------- | ---------------------------------------------------- |
| 1. Leaving Comments              | `add-comment`, `get-comments`, `update-comment`, `remove-comment`   | ✅ Full CRUD            | ✅ Full CRUD                | ✅ `comment-tools.test.ts`                           |
| 2. Setting Due Dates             | `update-task` (`dueDate` field)                                     | ✅                      | ✅                          | ✅ `task-tools.test.ts`                              |
| 3. Full Task Details             | `get-task`, `get-comments`                                          | ✅ (includes relations) | ✅                          | ✅ (partial — see gaps)                              |
| 4. Label Discovery & Application | `list-labels`, `create-label`, `add-task-label`                     | ✅                      | ✅                          | ✅ `label-tools.test.ts`, `task-label-tools.test.ts` |
| 5. Removing Labels               | `remove-task-label`                                                 | ✅                      | ✅                          | ✅                                                   |
| 6. Linking Related Tasks         | `add-task-relation`, `remove-task-relation`, `update-task-relation` | ✅ (frontmatter)        | ⚠️ Missing `updateRelation` | ✅ `task-relation-tools.test.ts`                     |
| 7. Creating a New Project        | `create-project`                                                    | ✅                      | ✅                          | ✅ `project-tools.test.ts`                           |
| 8. Archive / Delete Tasks        | `archive-task`, `delete-task` (with confirmation gate)              | ✅                      | ✅ delete only (no archive) | ✅                                                   |

### Confirmed gaps (mapped to user stories)

| #   | Gap                                                                                                                                                                                 | Story | File(s)                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------ |
| G1  | All tool descriptions and field descriptions hardcode "Kaneo"                                                                                                                       | All   | `src/tools/*.ts` (20+ files)                                             |
| G2  | `YouTrackProvider` does not implement `updateRelation`, but `tasks.relations` capability causes `update_task_relation` to be registered → runtime crash                             | 6     | `src/providers/youtrack/index.ts`, `src/providers/youtrack/relations.ts` |
| G3  | `get_task` description says "including relations" but omits comments; for Story 3 the LLM needs to call both `get_task` and `get_comments` — nothing in the description guides this | 3     | `src/tools/get-task.ts`                                                  |
| G4  | `add-task-relation` description leaks Kaneo-internal mechanism ("stored as frontmatter in the task description")                                                                    | 6     | `src/tools/add-task-relation.ts`                                         |
| G5  | `archive-task` description leaks Kaneo implementation ("by adding the 'archived' label")                                                                                            | 8     | `src/tools/archive-task.ts`                                              |
| G6  | `task-relation-tools.test.ts` directly asserts on the Kaneo-specific description string; will fail once G1 is fixed                                                                 | 6     | `tests/tools/task-relation-tools.test.ts`                                |
| G7  | `update-task-relation.ts` leaks "frontmatter" semantics in `type` enum description for the `blocked_by` / `duplicate_of` variants it omits                                          | 6     | `src/tools/update-task-relation.ts`                                      |

---

## Technical Architecture

### Component Map

```
User message
  └─ processMessage (llm-orchestrator.ts)
       └─ callLlm → generateText (AI SDK)
            └─ tool.execute (src/tools/*.ts)          ← tool descriptions shown to LLM
                 └─ provider.method (providers/*/index.ts)
                      ├─ KaneoProvider                ← frontmatter-based relations
                      └─ YouTrackProvider             ← native links API + execute commands
```

### Gap G2 — YouTrack `updateRelation` fix: two approaches

**Option A — Implement `updateYouTrackRelation` as remove + add (recommended)**

```
updateYouTrackRelation(config, taskId, relatedTaskId, type)
  ├─ removeYouTrackRelation(config, taskId, relatedTaskId)
  └─ addYouTrackRelation(config, taskId, relatedTaskId, type)
```

Pros: consistent result, uses existing, tested primitives.  
Cons: two API round trips; non-atomic (failure between the two leaves a dangling state).

**Option B — Refine `tasks.relations` into `tasks.relations.add`, `tasks.relations.remove`, `tasks.relations.update`**

Narrows the capability declaration so YouTrack does not register `update_task_relation` at all.

Pros: semantically precise, no risk of runtime crash.  
Cons: breaking change to `Capability` type and `makeTools`; more invasive.

**Decision**: Implement Option A. Option B is a clean-up that can be deferred to a capabilities refactor.

### Gap G1 — Making tool descriptions provider-neutral

Tool descriptions are static strings baked in at construction time (`tool({ description: '...' })`). Since the AI SDK `tool()` function is called at construction time and `TaskProvider` is passed in, the `provider.name` can be used to produce a provider-aware string, but the simplest and least error-prone approach is to replace hardcoded "Kaneo" references with generic terms ("task tracker", "the tracker"). This avoids creating conditional logic in 20+ files.

### Gap G3 — LLM guidance for full task details

The `get_task` description needs to instruct the LLM to call `get_comments` as a follow-up when the user asks for "full details" or "everything about a task". The change is a one-line description update.

### No new libraries required

All changes use:

- `bun:test` — test runner
- `zod` — already used for input schemas
- `ai` (`ToolSet`) — already used

---

## Detailed Task Breakdown

### Phase 1: Fix Runtime Bug (Critical) — 0.5 days

- [ ] **Task 1.1**: Implement `updateYouTrackRelation` in `src/providers/youtrack/relations.ts`
  - Estimate: 2h ±0.5h | Assignee: Backend | Priority: **High**
  - Acceptance Criteria:
    - `updateYouTrackRelation(config, taskId, relatedTaskId, type)` calls `removeYouTrackRelation` then `addYouTrackRelation` in sequence
    - if `removeYouTrackRelation` throws, the function re-throws without calling `addYouTrackRelation`
    - Unit test covers: successful update, removal-fails-and-add-is-not-called
  - Dependencies: none

- [ ] **Task 1.2**: Wire `updateRelation` into `YouTrackProvider`
  - Estimate: 0.5h | Assignee: Backend | Priority: **High**
  - Acceptance Criteria:
    - `YouTrackProvider.updateRelation(taskId, relatedTaskId, type)` method exists and delegates to `updateYouTrackRelation`
    - `tools-integration.test.ts` existing test for `update_task_relation` still passes
  - Dependencies: Task 1.1

### Phase 2: Fix Tool Description Provider Coupling — 1 day

The following 20 files require description surgery. All changes are string replacements — no logic changes.

- [ ] **Task 2.1**: Strip "Kaneo" from task tool descriptions
  - Files: `src/tools/create-task.ts`, `src/tools/update-task.ts`, `src/tools/get-task.ts`, `src/tools/list-tasks.ts`, `src/tools/search-tasks.ts`, `src/tools/archive-task.ts`, `src/tools/delete-task.ts`
  - Estimate: 1h ±0.25h | Assignee: Frontend/LLM | Priority: **Medium**
  - Acceptance Criteria:
    - No occurrence of the word "Kaneo" remains in `description` strings or `z.string().describe(...)` calls in any of these files
    - The word "archived label" is removed from `archive-task.ts` description (Gap G5)
    - Grep `grep -r '"Kaneo' src/tools/` returns zero results in these files
  - Dependencies: none
  - Specific replacements:
    - `'Kaneo task ID'` → `'task ID'`
    - `'Archive a Kaneo task by adding the "archived" label.'` → `'Archive a task. Use this to mark completed or stale tasks as archived.'`

- [ ] **Task 2.2**: Strip "Kaneo" from project tool descriptions
  - Files: `src/tools/create-project.ts`, `src/tools/list-projects.ts`, `src/tools/update-project.ts`, `src/tools/archive-project.ts`
  - Estimate: 0.5h | Assignee: Frontend/LLM | Priority: **Medium**
  - Acceptance Criteria: No occurrence of "Kaneo" in description strings in these files
  - Dependencies: none

- [ ] **Task 2.3**: Strip "Kaneo" from comment tool descriptions
  - Files: `src/tools/add-comment.ts`, `src/tools/get-comments.ts`, `src/tools/update-comment.ts`, `src/tools/remove-comment.ts`
  - Estimate: 0.5h | Assignee: Frontend/LLM | Priority: **Medium**
  - Acceptance Criteria: No occurrence of "Kaneo" in description strings in these files
  - Dependencies: none

- [ ] **Task 2.4**: Strip "Kaneo" from label and relation tool descriptions; fix G4 and G7
  - Files: `src/tools/list-labels.ts`, `src/tools/create-label.ts`, `src/tools/update-label.ts`, `src/tools/remove-label.ts`, `src/tools/add-task-label.ts`, `src/tools/remove-task-label.ts`, `src/tools/add-task-relation.ts`, `src/tools/remove-task-relation.ts`, `src/tools/update-task-relation.ts`
  - Estimate: 1h | Assignee: Frontend/LLM | Priority: **Medium**
  - Acceptance Criteria:
    - No occurrence of "Kaneo" in description strings in these files
    - `add-task-relation.ts` description no longer mentions "frontmatter" (Gap G4)
    - `update-task-relation.ts` description no longer mentions "frontmatter" (Gap G7)
    - New description for `add-task-relation`: `'Create a directed relation between two tasks (e.g. one blocks another, or marks a duplicate).'`
  - Dependencies: none

- [ ] **Task 2.5**: Update tests that assert on the old "Kaneo" description strings (Gap G6)
  - Files: `tests/tools/task-relation-tools.test.ts` (contains `.toContain('Create a relation between two Kaneo tasks')`)
  - Estimate: 0.5h | Assignee: Frontend/LLM | Priority: **Medium**
  - Acceptance Criteria:
    - The assertion is updated to match the new provider-neutral description
    - `bun test tests/tools/task-relation-tools.test.ts` passes
  - Dependencies: Task 2.4

### Phase 3: Story 3 — Full Task Details LLM Guidance (Gap G3) — 0.5 days

- [ ] **Task 3.1**: Update `get-task.ts` description to prompt LLM to also call `get_comments`
  - Estimate: 0.5h | Assignee: Frontend/LLM | Priority: **Medium**
  - Acceptance Criteria:
    - `get_task` description explicitly states that comments are retrieved separately via `get_comments`
    - Example: `'Fetch complete details of a single task including description, status, priority, assignee, due date, and relations. For a full picture including comments, also call get_comments with the same task ID.'`
    - Existing `task-tools.test.ts` description assertion is updated to match
  - Dependencies: none (can be done in parallel with Phase 2)

### Phase 4: Acceptance Criteria Validation Tests — 1 day

These tests verify the explicit acceptance criteria from the user stories end-to-end at the tool level, using the mock provider. They complement but do not replace existing tool unit tests.

- [ ] **Task 4.1**: `tests/tools/comment-tools.test.ts` — Story 1 AC coverage
  - Estimate: 1h | Assignee: QA/Backend | Priority: **Medium**
  - Acceptance Criteria:
    - Test: `add_comment` with task ID and text → returns comment with `id` and `body`
    - Test: provider error → tool re-throws (for LLM error handling)
    - These likely already pass; verify and add missing edge cases
  - Dependencies: Phase 2 description tasks (update `toContain` assertions if any)

- [ ] **Task 4.2**: `tests/tools/task-tools.test.ts` — Story 2 (due date) and Story 3 (full detail guidance) AC coverage
  - Estimate: 1h | Assignee: QA/Backend | Priority: **Medium**
  - Acceptance Criteria:
    - Test: `update_task` with `dueDate` → provider `updateTask` called with the date value
    - Test: `get_task` description contains the phrase "also call get_comments" (validates Gap G3 fix)
  - Dependencies: Task 3.1

- [ ] **Task 4.3**: `tests/tools/task-relation-tools.test.ts` — Story 6 AC coverage
  - Estimate: 1h | Assignee: QA/Backend | Priority: **Medium**
  - Acceptance Criteria:
    - Test: `add_task_relation` with type `'blocks'` → confirmed result returned
    - Test: description does NOT contain "frontmatter" (validates G4 fix)
    - Test: `update_task_relation` with type change → confirmed updated result returned
    - Test already exists; update description assertion and add frontmatter-absent check
  - Dependencies: Tasks 2.4, 2.5

- [ ] **Task 4.4**: `tests/providers/youtrack/provider.test.ts` — YouTrack `updateRelation` coverage
  - Estimate: 1.5h ±0.5h | Assignee: QA/Backend | Priority: **High**
  - Acceptance Criteria:
    - Test: `provider.updateRelation(taskId, relatedTaskId, 'related')` → calls remove command then add command in order
    - Test: fetch fails on remove step → function throws, add step is not called
    - Mocks: use existing `installFetchMock` / `mockFetchNoContent` pattern from the file
  - Dependencies: Tasks 1.1, 1.2

- [ ] **Task 4.5**: `tests/providers/youtrack/tools-integration.test.ts` — verify `update_task_relation` present
  - Estimate: 0.25h | Assignee: QA/Backend | Priority: **Low**
  - Acceptance Criteria:
    - Existing test that checks `toolNames` already includes `'update_task_relation'` for YouTrack
    - Explicitly add: `expect(toolNames).toContain('update_task_relation')` if not already present
  - Dependencies: Task 1.2

---

## Risk Assessment Matrix

| Risk                                                                                           | Probability | Impact | Mitigation                                                                                                                  | Owner        |
| ---------------------------------------------------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Breaking test assertions on "Kaneo" description strings (G6)                                   | High        | Low    | Update assertions in Task 2.5 as part of the same diff as Task 2.4                                                          | Dev          |
| YouTrack `updateRelation` Option A non-atomicity: remove succeeds, add fails → orphaned change | Low         | Medium | Wrap in try/catch; on add failure, log an error with both task IDs for manual recovery; document limitation in code comment | Backend      |
| Other tests contain Kaneo description string assertions not caught in the audit                | Low         | Low    | Run `grep -r '"Kaneo' tests/` before closing the phase; fix any remaining failures                                          | Dev          |
| LLM still does not call `get_comments` even after description update (G3)                      | Medium      | Low    | If e2e tests show the pattern, consider a composite `get_task_full` tool that calls both internally; defer until observed   | Frontend/LLM |
| `getComment` method on `TaskProvider` interface exists in mock but is not exercised anywhere   | Low         | Low    | Out of scope for Phase 2; no user story requires fetching a single comment by ID                                            | —            |

---

## Resource Requirements

- **Development Hours**: 12–16h total
- **Skills Required**: TypeScript, Bun test patterns, YouTrack HTTP API (for Task 1.1 test)
- **External Dependencies**: None
- **Testing Requirements**: All changes must pass `bun test` before merge; no new oxlint violations

---

## No New Libraries Required

All functionality is delivered using existing dependencies:

| Library              | Current Version   | Purpose                              |
| -------------------- | ----------------- | ------------------------------------ |
| `ai` (Vercel AI SDK) | already installed | `tool()` constructor, `ToolSet` type |
| `zod`                | already installed | Tool input schemas                   |
| `bun:test`           | built-in          | Test runner                          |
| `pino`               | already installed | Structured logging                   |

---

## Delivery Sequence

```
Day 1:  Task 1.1 → Task 1.2 → Task 4.4 → Task 4.5   (YouTrack updateRelation bug fixed + tested)
Day 2:  Tasks 2.1–2.4 in parallel → Task 2.5          (All "Kaneo" stripped from tool descriptions)
Day 3:  Task 3.1 → Task 4.2 → Task 4.3               (Story 3 guidance + relation test updates)
Day 4:  Tasks 4.1, buffer, full bun test run, review  (Validation pass)
```

---

## Planning Quality Gates

**✅ Requirements Coverage**

- [x] All 8 acceptance criteria mapped to specific tasks
- [x] Scope defined: no new tool creation, no new provider operations beyond `updateYouTrackRelation`
- [x] Non-functional: no Kaneo-specific strings visible to the LLM after Phase 2 completes

**✅ Task Specification**

- [x] Each task has measurable completion criteria (grep check or test assertion)
- [x] Effort estimates provided with confidence intervals
- [x] Dependencies mapped

**✅ Risk Management**

- [x] YouTrack non-atomic update documented with mitigation
- [x] Assertion breakage risk identified and mitigation specified
- [x] No high-probability × high-impact risks outstanding

**✅ Timeline Realism**

- [x] 20% buffer day included (Day 4)
- [x] Parallel workstreams identified (Phase 2 tasks 2.1–2.4 are independent)
- [x] Smallest diff-first ordering (bug fix before cosmetic description changes)

**✅ Library Research**

- [x] No new libraries required — all needed functionality already in the dependency tree
- [x] No third-party risk introduced

---

## 📋 DISPLAY INSTRUCTIONS FOR OUTER AGENT

**Outer Agent: You MUST present this development plan using the following format:**

1. **Present the COMPLETE development roadmap** - Do not summarize or abbreviate sections
2. **Preserve ALL task breakdown structures** with checkboxes and formatting intact
3. **Show the full risk assessment matrix** with all columns and rows
4. **Display ALL planning templates exactly as generated** - Do not merge sections
5. **Maintain all markdown formatting** including tables, checklists, and code blocks
6. **Present the complete technical specification** without condensing
7. **Show ALL quality gates and validation checklists** in full detail
8. **Display the complete library research section** with all recommendations and evaluations

**Do NOT create an executive summary or overview - present the complete development plan exactly as generated with all detail intact.**
