# Knip Dead Code Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve all 250+ issues reported by `bun run knip` to achieve a clean zero-issue run.

**Architecture:** Incremental deletion and refactoring, organized from highest-impact/lowest-risk (unused files) to most surgical (individual unused exports). Each task is verified by running `bun run knip` and `bun run test` to catch regressions.

**Tech Stack:** Bun, TypeScript, knip, oxlint

---

## Issue Summary

| Category                | Count | Fix Strategy                                |
| ----------------------- | ----- | ------------------------------------------- |
| Unused files            | 49    | Delete files                                |
| Unlisted dependencies   | 4     | Add to package.json                         |
| Unresolved imports      | 1     | Fix import path                             |
| Unused exports (values) | 194   | Remove `export` keyword or delete dead code |
| Unused exported types   | 159   | Remove `export` keyword or delete dead code |
| Duplicate exports       | 12    | Deduplicate schema aliases                  |

---

### Task 1: Delete 48 Unused Kaneo Schema Files

These files were auto-generated from the Kaneo OpenAPI spec but are never imported by any source or test file. 13 schema files ARE used and must be kept.

**Files to delete:**

```
src/providers/kaneo/schemas/clear-all-notifications.ts
src/providers/kaneo/schemas/create-github-integration.ts
src/providers/kaneo/schemas/create-notification.ts
src/providers/kaneo/schemas/create-time-entry.ts
src/providers/kaneo/schemas/createActivity.ts
src/providers/kaneo/schemas/createColumn.ts
src/providers/kaneo/schemas/delete-github-integration.ts
src/providers/kaneo/schemas/delete-project.ts
src/providers/kaneo/schemas/delete-workflow-rule.ts
src/providers/kaneo/schemas/deleteColumn.ts
src/providers/kaneo/schemas/deleteComment.ts
src/providers/kaneo/schemas/deleteLabel.ts
src/providers/kaneo/schemas/deleteTask.ts
src/providers/kaneo/schemas/exportTasks.ts
src/providers/kaneo/schemas/get-config.ts
src/providers/kaneo/schemas/get-external-links-by-task.ts
src/providers/kaneo/schemas/get-github-app-info.ts
src/providers/kaneo/schemas/get-github-integration.ts
src/providers/kaneo/schemas/get-invitation-details.ts
src/providers/kaneo/schemas/get-label.ts
src/providers/kaneo/schemas/get-task-labels.ts
src/providers/kaneo/schemas/get-task-time-entries.ts
src/providers/kaneo/schemas/get-time-entry.ts
src/providers/kaneo/schemas/get-user-pending-invitations.ts
src/providers/kaneo/schemas/get-workflow-rules.ts
src/providers/kaneo/schemas/get-workspace-labels.ts
src/providers/kaneo/schemas/getColumns.ts
src/providers/kaneo/schemas/import-github-issues.ts
src/providers/kaneo/schemas/importTasks.ts
src/providers/kaneo/schemas/list-github-repositories.ts
src/providers/kaneo/schemas/list-notifications.ts
src/providers/kaneo/schemas/list-projects.ts
src/providers/kaneo/schemas/mark-all-notifications-as-read.ts
src/providers/kaneo/schemas/mark-notification-as-read.ts
src/providers/kaneo/schemas/reorderColumns.ts
src/providers/kaneo/schemas/update-github-integration.ts
src/providers/kaneo/schemas/update-label.ts
src/providers/kaneo/schemas/update-task-due-date.ts
src/providers/kaneo/schemas/update-task-priority.ts
src/providers/kaneo/schemas/update-task-status.ts
src/providers/kaneo/schemas/update-task-title.ts
src/providers/kaneo/schemas/update-time-entry.ts
src/providers/kaneo/schemas/updateColumn.ts
src/providers/kaneo/schemas/updateTask.ts
src/providers/kaneo/schemas/updateTaskAssignee.ts
src/providers/kaneo/schemas/updateTaskDescription.ts
src/providers/kaneo/schemas/upsert-workflow-rule.ts
src/providers/kaneo/schemas/verify-github-installation.ts
```

**Step 1: Delete all 48 files**

```bash
rm src/providers/kaneo/schemas/{clear-all-notifications,create-github-integration,create-notification,create-time-entry,createActivity,createColumn,delete-github-integration,delete-project,delete-workflow-rule,deleteColumn,deleteComment,deleteLabel,deleteTask,exportTasks,get-config,get-external-links-by-task,get-github-app-info,get-github-integration,get-invitation-details,get-label,get-task-labels,get-task-time-entries,get-time-entry,get-user-pending-invitations,get-workflow-rules,get-workspace-labels,getColumns,import-github-issues,importTasks,list-github-repositories,list-notifications,list-projects,mark-all-notifications-as-read,mark-notification-as-read,reorderColumns,update-github-integration,update-label,update-task-due-date,update-task-priority,update-task-status,update-task-title,update-time-entry,updateColumn,updateTask,updateTaskAssignee,updateTaskDescription,upsert-workflow-rule,verify-github-installation}.ts
```

**Step 2: Verify no breakage**

Run: `bun run test`
Expected: All tests pass (these files were never imported).

**Step 3: Commit**

```bash
git add -A src/providers/kaneo/schemas/
git commit -m "chore: delete 48 unused auto-generated kaneo schema files"
```

---

### Task 2: Delete Duplicate File `src/prompts/system.ts`

This file is an exact duplicate of code already defined inline in `src/bot.ts` (lines 30-66). Zero imports reference it.

**Files:**

- Delete: `src/prompts/system.ts`

**Step 1: Delete the file**

```bash
rm src/prompts/system.ts
rmdir src/prompts  # remove empty directory
```

**Step 2: Verify no breakage**

Run: `bun run test`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/prompts/
git commit -m "chore: delete duplicate src/prompts/system.ts (code lives in bot.ts)"
```

---

### Task 3: Add Unlisted Dependencies to `package.json`

Three transitive dependencies are imported directly in source code but not listed in `package.json`. They must be added as explicit dependencies.

| Package            | Used In                                       | Transitive From                   |
| ------------------ | --------------------------------------------- | --------------------------------- |
| `@grammyjs/types`  | `src/announcements.ts`, `src/utils/format.ts` | `grammy`                          |
| `@ai-sdk/provider` | `src/bot.ts`                                  | `ai`, `@ai-sdk/openai-compatible` |
| `@gramio/types`    | `src/utils/format.ts`                         | `@gramio/format`                  |

**Step 1: Add dependencies**

```bash
bun add @grammyjs/types @ai-sdk/provider @gramio/types
```

**Step 2: Verify knip no longer reports unlisted deps**

Run: `bun run knip 2>&1 | grep "Unlisted dependencies"`
Expected: No output (section gone).

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add directly-imported transitive deps to package.json"
```

---

### Task 4: Fix Unresolved Import in YouTrack Test

`tests/providers/youtrack/schemas/common.test.ts` has a wrong relative import path (3 `..` levels instead of 4).

**Files:**

- Modify: `tests/providers/youtrack/schemas/common.test.ts`

**Step 1: Read the file and identify the import**

The import at line 9 should be:

```typescript
// WRONG:  from '../../../src/providers/youtrack/schemas/common.js'
// RIGHT:  from '../../../../src/providers/youtrack/schemas/common.js'
```

**Step 2: Fix the import path**

Add one more `../` level to reach the project root from `tests/providers/youtrack/schemas/`.

**Step 3: Verify**

Run: `bun run test`
Expected: Test passes (previously may have failed or been silently skipped).

**Step 4: Commit**

```bash
git add tests/providers/youtrack/schemas/common.test.ts
git commit -m "fix: correct relative import path in youtrack schema test"
```

---

### Task 5: Remove Backward-Compat Barrel Re-exports from `src/providers/kaneo/index.ts`

Lines 239-291 re-export ~30 functions, types, and classes "for backward compatibility" that are **never imported** from this path. The `KaneoProvider` class is the only thing consumers use from this module.

**Files:**

- Modify: `src/providers/kaneo/index.ts`

**Step 1: Grep to confirm no external consumers**

```bash
# Check that nothing imports the old function names from the index barrel
grep -r "from.*providers/kaneo/index" src/ tests/ --include="*.ts" | grep -v "KaneoProvider\|KaneoConfig"
grep -r "from.*providers/kaneo'" src/ tests/ --include="*.ts" | grep -v "KaneoProvider\|KaneoConfig"
```

Expected: No matches for the legacy function names.

**Step 2: Delete the backward-compat re-export block**

Remove everything from `// Re-export all API functions for backward compatibility` (line 238) through the end of the file (line 291), keeping only the `KaneoProvider` class and the `KaneoConfig` type re-export.

The file should end after:

```typescript
/** Re-export KaneoConfig so the registry imports from the provider layer. */
export type { KaneoConfig }
```

**Step 3: Verify**

Run: `bun run test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/providers/kaneo/index.ts
git commit -m "chore: remove unused backward-compat re-exports from kaneo provider"
```

---

### Task 6: Delete `src/providers/kaneo/api.ts` Barrel File

After Task 5, `api.ts` is only imported by `src/providers/kaneo/operations/relations.ts`. That import should be redirected to the actual source files, then `api.ts` can be deleted.

**Files:**

- Delete: `src/providers/kaneo/api.ts`
- Modify: `src/providers/kaneo/operations/relations.ts` (redirect imports)

**Step 1: Read `src/providers/kaneo/operations/relations.ts` to find the api.ts import**

It imports `addTaskRelation`, `removeTaskRelation`, `updateTaskRelation` from `../api.js`. These originate from `../task-relations.js`.

**Step 2: Redirect the import**

```typescript
// BEFORE: import { addTaskRelation, removeTaskRelation, updateTaskRelation } from '../api.js'
// AFTER:  import { addTaskRelation, removeTaskRelation, updateTaskRelation } from '../task-relations.js'
```

**Step 3: Delete api.ts**

```bash
rm src/providers/kaneo/api.ts
```

**Step 4: Verify**

Run: `bun run test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/providers/kaneo/api.ts src/providers/kaneo/operations/relations.ts
git commit -m "chore: delete kaneo api.ts barrel, redirect imports to source"
```

---

### Task 7: Remove Unused App-Level Exports

Remove the `export` keyword from functions and types that are never imported outside their own module. For each item, verify it's only used locally (already confirmed by analysis).

**Files to modify:**

| File                                            | Export to Un-export                                           |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `src/cache.ts:170`                              | `getAllCachedConfig` — remove `export`                        |
| `src/commands/help.ts:7`                        | `USER_COMMANDS` — remove `export`                             |
| `src/commands/help.ts:14`                       | `ADMIN_COMMANDS` — remove `export`                            |
| `src/conversation.ts:66`                        | `getOrCreateHistory` — remove `export`                        |
| `src/conversation.ts:76`                        | `trimAndSummarise` — remove `export`                          |
| `src/providers/registry.ts:37`                  | `isProviderName` — remove `export`                            |
| `src/providers/registry.ts:60`                  | `listProviders` — remove `export`                             |
| `src/providers/registry.ts:8`                   | `ProviderName` type — remove `export`                         |
| `src/providers/registry.ts:12`                  | `ProviderFactory` type — remove `export`                      |
| `src/providers/types.ts:279`                    | `hasCapability` — remove `export`                             |
| `src/memory.ts:12`                              | `MemoryFact` type — remove `export`                           |
| `src/memory.ts:19`                              | `ModelConfig` type — remove `export`                          |
| `src/memory.ts:157`                             | `TrimResult` type — remove `export`                           |
| `src/tools/confirmation-gate.ts:26`             | `ConfirmationRequired` type — remove `export`                 |
| `src/users.ts:7`                                | `UserRecord` interface — remove `export`                      |
| `src/providers/kaneo/task-archive.ts`           | `ARCHIVE_LABEL_NAME`, `ARCHIVE_LABEL_COLOR` — remove `export` |
| `src/providers/kaneo/task-update-helpers.ts:28` | `singleFieldUpdate` — remove `export`                         |

**Step 1: For each file, change `export function/const/type/interface` to just `function/const/type/interface`**

Use targeted edits. Example:

```typescript
// BEFORE: export function getAllCachedConfig(...) {
// AFTER:  function getAllCachedConfig(...) {
```

For types:

```typescript
// BEFORE: export type MemoryFact = ...
// AFTER:  type MemoryFact = ...
```

**Step 2: Verify**

Run: `bun run test && bun run lint`
Expected: All pass. If `noUnusedLocals` fires on any un-exported item that's also unused locally, delete it entirely.

**Step 3: Commit**

```bash
git add src/cache.ts src/commands/help.ts src/conversation.ts src/providers/registry.ts src/providers/types.ts src/memory.ts src/tools/confirmation-gate.ts src/users.ts src/providers/kaneo/task-archive.ts src/providers/kaneo/task-update-helpers.ts
git commit -m "chore: un-export unused app-level functions and types"
```

---

### Task 8: Remove Unused Exports from Kaneo Schema Files (Used Files)

The 13 kept schema files export Zod schemas, inferred types, and enum types. Many of these exports are unused. Remove the `export` keyword from unused schemas and types within each file.

**Files to modify (all in `src/providers/kaneo/schemas/`):**

- `api-compat.ts` — un-export: `ColumnWithTasksCompatSchema`, `SearchResultItemSchema`, and types `CreateCommentResponseCompat`, `UpdateCommentResponseCompat`, `ColumnCompat`, `ListTasksResponseCompat`, `SearchResultItem`, `GlobalSearchResponseCompat`
- `column.ts` — un-export: `ColumnSchema`, `ColumnWithPositionSchema`, and types `Column`, `ColumnWithPosition`
- `create-project.ts` — un-export: `CreateProjectRequestSchema`, and types `CreateProjectRequest`, `CreateProjectResponse`
- `createComment.ts` — un-export: `ActivityTypeEnum`, `CreateCommentRequestSchema`, and types `CreateCommentRequest`, `CreateCommentResponse`
- `createLabel.ts` — un-export: `CreateLabelRequestSchema`, and type `CreateLabelRequest`
- `createTask.ts` — un-export: `TaskPriorityEnum`, `CreateTaskPathSchema`, `CreateTaskBodySchema`, `CreateTaskRequestSchema`, and types `TaskPriority`, `CreateTaskPath`, `CreateTaskBody`, `CreateTaskRequest`, `Task`
- `get-project.ts` — un-export: `GetProjectPathParamsSchema`, `GetProjectQueryParamsSchema`, and types `GetProjectPathParams`, `GetProjectQueryParams`, `GetProjectResponse`
- `getActivities.ts` — un-export: `ActivityTypeEnum`, `GetActivitiesPathParamsSchema`, and types `GetActivitiesPathParams`, `ActivityItem`, `GetActivitiesResponse`
- `getTask.ts` — un-export: `TaskPriorityEnum`, `GetTaskPathSchema`, `GetTaskRequestSchema`, and types `TaskPriority`, `GetTaskPath`, `GetTaskRequest`, `GetTaskResponse`
- `global-search.ts` — un-export: `SearchTypeEnum`, `TaskPriorityEnum`, `CommentTypeEnum`, `GlobalSearchQuerySchema`, `GlobalSearchRequestSchema`, `SearchProjectSchema`, `SearchWorkspaceSchema`, `SearchCommentSchema`, `GlobalSearchResponseSchema`, and all corresponding types
- `listTasks.ts` — un-export: `ListTasksPathSchema`, `ListTasksRequestSchema`, `ListTasksResponseSchema`, `ColumnWithTasksSchema`, and types `ListTasksPath`, `ListTasksRequest`, `ListTasksResponse`, `Column`
- `update-project.ts` — un-export: `UpdateProjectPathSchema`, `UpdateProjectBodySchema`, `UpdateProjectRequestSchema`, and types `UpdateProjectPath`, `UpdateProjectBody`, `UpdateProjectRequest`, `UpdateProjectResponse`
- `updateComment.ts` — un-export: `ActivityTypeEnum`, `UpdateCommentRequestSchema`, and types `UpdateCommentRequest`, `UpdateCommentResponse`

**Step 1: For each file, remove `export` from the flagged items**

Be careful to keep exports that ARE used. Check imports in the codebase before un-exporting. The response schemas and compat schemas used by operation files must stay exported.

**Step 2: Verify**

Run: `bun run test && bun run lint`
Expected: All pass. TypeScript's `noUnusedLocals` may flag items that become dead after un-exporting — delete those entirely.

**Step 3: Commit**

```bash
git add src/providers/kaneo/schemas/
git commit -m "chore: un-export unused schemas and types from kaneo schema files"
```

---

### Task 9: Remove Unused Exports from Kaneo Operation/Helper Files

Individual Kaneo files export types that are never imported elsewhere.

**Files to modify:**

| File                                      | Exports to Un-export                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `src/providers/kaneo/add-task-label.ts`   | type `KaneoLabel`                                                        |
| `src/providers/kaneo/create-column.ts`    | type `CreateColumnResponse`                                              |
| `src/providers/kaneo/create-label.ts`     | types `CreateLabelResponse`, `KaneoLabel`                                |
| `src/providers/kaneo/create-project.ts`   | types `CreateProjectResponse`, `KaneoProject`                            |
| `src/providers/kaneo/get-comments.ts`     | type `KaneoActivity`                                                     |
| `src/providers/kaneo/get-task.ts`         | type `KaneoTaskResponse`                                                 |
| `src/providers/kaneo/list-columns.ts`     | type `KaneoColumn`                                                       |
| `src/providers/kaneo/list-labels.ts`      | type `KaneoLabel`                                                        |
| `src/providers/kaneo/list-projects.ts`    | type `KaneoProject`                                                      |
| `src/providers/kaneo/provision.ts`        | type `ProvisionResult`                                                   |
| `src/providers/kaneo/update-column.ts`    | type `UpdateColumnResponse`                                              |
| `src/providers/kaneo/update-label.ts`     | type `KaneoLabel`                                                        |
| `src/providers/kaneo/update-project.ts`   | types `UpdateProjectResponse`, `KaneoProject`                            |
| `src/providers/kaneo/client.ts`           | re-exports `KaneoApiError`, `KaneoValidationError`                       |
| `src/providers/kaneo/task-list-schema.ts` | `ColumnSchema`, `GetTasksTaskSchema`                                     |
| `src/providers/kaneo/task-resource.ts`    | re-exports `addTaskRelation`, `removeTaskRelation`, `updateTaskRelation` |

**Step 1: For each file, remove `export` from the flagged types**

Most are `export type X = z.infer<...>` — change to `type X = z.infer<...>`.

For `client.ts`: remove the re-export line for `KaneoApiError` and `KaneoValidationError` (they're already exported from `errors.ts`).

For `task-list-schema.ts`: un-export `ColumnSchema` and `GetTasksTaskSchema` if they're truly only used within the file or already available from other paths.

For `task-resource.ts`: verify whether the re-exports of relation functions are consumed. If only e2e tests import from `task-relations.js` directly, remove the re-export from `task-resource.ts`.

**Step 2: Verify**

Run: `bun run test && bun run lint`
Expected: All pass.

**Step 3: Commit**

```bash
git add src/providers/kaneo/
git commit -m "chore: un-export unused types from kaneo operation files"
```

---

### Task 10: Remove Unused YouTrack Schema Exports

The YouTrack schemas are only used in tests but export many schemas and types that are never imported. There are two options:

**Option A (conservative):** Keep the files, un-export unused items.
**Option B (aggressive):** Since the YouTrack provider doesn't use schemas at runtime, consider whether the schema files are worth keeping.

**Recommended: Option A** — un-export unused items from each file.

**Files to modify (all in `src/providers/youtrack/schemas/`):**

- `agile.ts` — un-export all schemas and types flagged by knip
- `comment.ts` — un-export all schemas and types flagged
- `common.ts` — un-export all types flagged
- `custom-fields.ts` — un-export all schemas and types flagged
- `issue-link.ts` — un-export all schemas and types flagged
- `issue.ts` — un-export all schemas and types flagged
- `project.ts` — un-export all schemas and types flagged
- `tag.ts` — un-export all schemas and types flagged
- `user.ts` — un-export type `User`, `UserReference`
- `index.ts` — after un-exporting, update re-exports to match

**Important:** These schemas ARE imported by test files. Before un-exporting, check which specific schemas and types are imported by `tests/providers/youtrack/`. Only un-export items not needed by tests.

**Step 1: Grep each schema file for test imports**

```bash
grep -r "from.*youtrack/schemas" tests/ --include="*.ts"
```

**Step 2: Un-export items not imported by tests**

**Step 3: Verify**

Run: `bun run test && bun run lint`
Expected: All pass.

**Step 4: Commit**

```bash
git add src/providers/youtrack/schemas/
git commit -m "chore: un-export unused youtrack schema exports"
```

---

### Task 11: Remove Unused Script Exports

Scripts in `src/scripts/` export types and functions only used internally.

**Files to modify:**

| File                                   | Exports to Un-export                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/scripts/kaneo-import-helpers.ts`  | `CreateCommentBodySchema`, `UpdateTaskDescriptionBodySchema`                                                                  |
| `src/scripts/kaneo-import.ts`          | `assignLabels`, `markArchived`, `importComments`, `buildRelations`, types `KaneoLabel`, `KaneoProject`, `EnsureColumnsResult` |
| `src/scripts/linear-client.ts`         | `LinearCommentSchema`, `LinearRelationSchema`, types `LinearComment`, `LinearRelation`                                        |
| `src/scripts/queue.ts`                 | interfaces `QueueItem`, `QueueOptions`                                                                                        |
| `src/scripts/test-migration-infra.ts`  | interface `AuthSession`                                                                                                       |
| `src/scripts/test-migration-verify.ts` | interface `VerificationResult`                                                                                                |

**Step 1: Remove `export` from each flagged item**

**Step 2: Verify**

Run: `bun run test && bun run lint`
Expected: All pass.

**Step 3: Commit**

```bash
git add src/scripts/
git commit -m "chore: un-export unused script-level exports"
```

---

### Task 12: Fix Duplicate Exports in Schema Files

Knip reports 12 duplicate export pairs where two different schemas resolve to the same Zod object. Fix by removing the alias and using a single canonical name.

**Kaneo duplicates (3):**

- `createTask.ts`: `TaskSchema` duplicated as `CreateTaskResponseSchema`
- `getTask.ts`: `TaskSchema` duplicated as `GetTaskResponseSchema`
- `update-project.ts`: `ProjectSchema` duplicated as `UpdateProjectResponseSchema`

**YouTrack duplicates (9):**

- `agile.ts`: 3 pairs (query/request, board/response, column/response)
- `comment.ts`: `CommentSchema` duplicated as response schemas
- `issue-link.ts`: `IssueLinkSchema` duplicated as response
- `issue.ts`: `IssueSchema` duplicated as 3 response schemas + query/request
- `project.ts`: `ProjectSchema` duplicated as 3 response schemas
- `tag.ts`: `TagSchema` duplicated as 2 response schemas

**Step 1: For each duplicate pair, check if both names are used**

If one name is unused (likely the alias), delete the alias. If both are used, keep only the canonical name and update references.

**Step 2: Remove alias re-exports**

Example for `createTask.ts`:

```typescript
// BEFORE: export const CreateTaskResponseSchema = TaskSchema
// AFTER:  (delete this line, use TaskSchema directly)
```

Update any files that import the alias to use the canonical name instead.

**Step 3: Verify**

Run: `bun run test && bun run lint`
Expected: All pass.

**Step 4: Commit**

```bash
git add src/providers/kaneo/schemas/ src/providers/youtrack/schemas/
git commit -m "chore: deduplicate schema aliases across kaneo and youtrack"
```

---

### Task 13: Handle Remaining `YouTrackConfig` and `MigrationOptions` False Positives

If knip still reports `YouTrackConfig`, `MigrationOptions`, or `ProgressCallback` after the above fixes, add targeted `ignoreExportsUsedInFile` or `ignoreIssues` entries to `knip.jsonc` — but only after confirming they're genuine false positives.

**Step 1: Run knip and check remaining issues**

```bash
bun run knip 2>&1
```

**Step 2: For any remaining false positives, add to knip config**

```jsonc
// Only if confirmed false positives remain:
"ignoreExportsUsedInFile": true
```

**Step 3: Commit**

```bash
git add knip.jsonc
git commit -m "chore: suppress confirmed knip false positives"
```

---

### Task 14: Final Verification

**Step 1: Run the full knip check**

```bash
bun run knip
```

Expected: Exit code 0 with zero issues.

**Step 2: Run the full test suite**

```bash
bun run test
```

Expected: All tests pass.

**Step 3: Run linter**

```bash
bun run lint
```

Expected: Clean.

**Step 4: Final commit if any fixups needed**

```bash
git commit -m "chore: final knip cleanup adjustments"
```
