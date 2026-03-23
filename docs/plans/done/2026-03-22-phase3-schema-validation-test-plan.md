# Phase 3: Strengthen Schema & Validation Suites — Detailed Test Plan

**Date:** 2026-03-22
**Status:** Draft
**Parent:** [Test Improvement Roadmap](./2026-03-22-test-improvement-roadmap.md)
**Priority:** High
**Estimate:** 8–10h
**Prerequisite:** None (can run in parallel with Phase 2)

---

## Goal

Schema tests catch API response changes before they reach production logic. Every Zod schema should reject malformed input deterministically and document the boundary between "accepted" and "rejected" data shapes.

---

## Scope

| In Scope                                                               | Out of Scope                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 7 YouTrack schema test files + 1 new `custom-fields.test.ts`           | YouTrack provider integration tests                               |
| Kaneo `client.test.ts` header value assertions                         | Kaneo resource-level tests (covered in Phase 4/5)                 |
| Missing `await` on `expect().rejects` across **all** 17 affected files | Rewriting test logic (only adding `await` + removing workarounds) |

---

## Task 3.1 — Expand YouTrack Schema Tests

### Current State

| Schema File        | Source Location                                   | Test Location                                         | Current Tests | Score |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------- | :-----------: | :---: |
| `common.ts`        | `src/providers/youtrack/schemas/common.ts`        | `tests/providers/youtrack/schemas/common.test.ts`     |       2       | 4/10  |
| `user.ts`          | `src/providers/youtrack/schemas/user.ts`          | `tests/providers/youtrack/schemas/user.test.ts`       |       3       | 5/10  |
| `comment.ts`       | `src/providers/youtrack/schemas/comment.ts`       | `tests/providers/youtrack/schemas/comment.test.ts`    |       1       | 4/10  |
| `tag.ts`           | `src/providers/youtrack/schemas/tag.ts`           | `tests/providers/youtrack/schemas/tag.test.ts`        |       2       | 5/10  |
| `project.ts`       | `src/providers/youtrack/schemas/project.ts`       | `tests/providers/youtrack/schemas/project.test.ts`    |       2       | 5/10  |
| `issue-link.ts`    | `src/providers/youtrack/schemas/issue-link.ts`    | `tests/providers/youtrack/schemas/issue-link.test.ts` |       1       | 4/10  |
| `issue.ts`         | `src/providers/youtrack/schemas/issue.ts`         | `tests/providers/youtrack/schemas/issue.test.ts`      |       1       | 4/10  |
| `custom-fields.ts` | `src/providers/youtrack/schemas/custom-fields.ts` | **None**                                              |       0       |  N/A  |

### Target State

Each schema file: **8–15 tests**. Total new tests: ~70–90.

---

### Task 3.1.1 — `common.test.ts` (BaseEntitySchema + TimestampSchema)

**Current:** 2 tests — validates happy path only.

#### New tests to add:

**BaseEntitySchema:**
| # | Test Description | Input | Expected |
|---|-----------------|-------|----------|
| 1 | Missing `id` → rejects | `{ $type: 'Issue' }` | `ZodError` with path `['id']` |
| 2 | `id` as number → rejects | `{ id: 123, $type: 'Issue' }` | `ZodError` |
| 3 | `$type` omitted → accepts (optional) | `{ id: '123' }` | Parses successfully, `$type` is `undefined` |
| 4 | Empty string `id` → accepts (no `.min(1)`) | `{ id: '' }` | Parses successfully |
| 5 | Extra unknown fields → stripped by Zod default | `{ id: '1', $type: 'X', extra: true }` | Parses, result has no `extra` key |
| 6 | `null` for `id` → rejects | `{ id: null }` | `ZodError` |
| 7 | Empty object → rejects | `{}` | `ZodError` with path `['id']` |

**TimestampSchema:**
| # | Test Description | Input | Expected |
|---|-----------------|-------|----------|
| 8 | Float → rejects (`.int()`) | `1700000000000.5` | `ZodError` |
| 9 | Zero → rejects (`.positive()`) | `0` | `ZodError` |
| 10 | Negative → rejects (`.positive()`) | `-1` | `ZodError` |
| 11 | `null` → rejects | `null` | `ZodError` |
| 12 | ISO string → rejects | `'2024-01-01T00:00:00Z'` | `ZodError` |

**Acceptance Criteria:**

- [ ] ≥12 tests total (up from 2)
- [ ] Every required field has a "missing" rejection test
- [ ] Every type constraint (`.int()`, `.positive()`, `.string()`) has a wrong-type test

---

### Task 3.1.2 — `user.test.ts` (UserSchema + UserReferenceSchema)

**Current:** 3 tests — happy path + one missing-field test for `login`.

#### Schema field analysis:

**UserSchema** fields:

- `id` (required, string — from BaseEntitySchema)
- `$type` (optional, string — from BaseEntitySchema)
- `login` (required, string)
- `fullName` (required, string)
- `email` (optional, string)
- `avatarUrl` (optional, string)
- `created` (optional, TimestampSchema)
- `lastAccess` (optional, TimestampSchema)

**UserReferenceSchema** fields:

- `id` (required, string)
- `$type` (optional, string)
- `login` (required, string)
- `name` (optional, string)

#### New tests to add:

**UserSchema:**
| # | Test Description | Input Mutation | Expected |
|---|-----------------|----------------|----------|
| 1 | Missing `fullName` → rejects | Omit `fullName` from valid | `ZodError` path `['fullName']` |
| 2 | Missing `id` → rejects | Omit `id` from valid | `ZodError` path `['id']` |
| 3 | `login` as number → rejects | `login: 42` | `ZodError` |
| 4 | `fullName` as number → rejects | `fullName: 42` | `ZodError` |
| 5 | `email` as `null` → rejects (optional but not nullable) | `email: null` | `ZodError` |
| 6 | `email` as `undefined` → accepts | Omit `email` | Parses, `email` is `undefined` |
| 7 | `created` as string → rejects | `created: '2024-01-01'` | `ZodError` |
| 8 | `created` as negative number → rejects | `created: -1` | `ZodError` |
| 9 | Minimal valid (only required fields) | `{ id, login, fullName }` | Parses successfully |
| 10 | Extra fields stripped | `{ ...valid, unknownField: 'x' }` | Parses, no `unknownField` |

**UserReferenceSchema:**
| # | Test Description | Input Mutation | Expected |
|---|-----------------|----------------|----------|
| 11 | Missing `login` → rejects | `{ id: '1' }` | `ZodError` |
| 12 | `name` omitted → accepts | `{ id: '1', login: 'x' }` | Parses, `name` is `undefined` |
| 13 | `name` as `null` → rejects | `{ id: '1', login: 'x', name: null }` | `ZodError` |

**Acceptance Criteria:**

- [ ] ≥13 tests total (up from 3)
- [ ] Both `UserSchema` and `UserReferenceSchema` have missing-field and wrong-type tests
- [ ] Optional vs nullable distinction verified for `email`, `name`

---

### Task 3.1.3 — `comment.test.ts` (CommentSchema)

**Current:** 1 test — happy path only.

#### Schema field analysis:

**CommentSchema** fields:

- `id` (required, string)
- `$type` (optional, string)
- `text` (required, string)
- `textPreview` (optional, string)
- `author` (required, lazy UserReferenceSchema)
- `created` (required, TimestampSchema)
- `updated` (optional, TimestampSchema)
- `deleted` (optional, boolean)
- `pinned` (optional, boolean)

#### New tests to add:

| #   | Test Description                      | Input Mutation                               | Expected                              |
| --- | ------------------------------------- | -------------------------------------------- | ------------------------------------- |
| 1   | Missing `text` → rejects              | Omit `text`                                  | `ZodError` path `['text']`            |
| 2   | Missing `author` → rejects            | Omit `author`                                | `ZodError` path `['author']`          |
| 3   | Missing `created` → rejects           | Omit `created`                               | `ZodError` path `['created']`         |
| 4   | `author` as string → rejects          | `author: 'john'`                             | `ZodError`                            |
| 5   | `author` missing `login` → rejects    | `author: { id: '1' }`                        | `ZodError` path `['author', 'login']` |
| 6   | `text` as number → rejects            | `text: 42`                                   | `ZodError`                            |
| 7   | `created` as string → rejects         | `created: 'yesterday'`                       | `ZodError`                            |
| 8   | `updated` omitted → accepts           | Omit `updated`                               | Parses, `updated` is `undefined`      |
| 9   | `deleted` as string → rejects         | `deleted: 'true'`                            | `ZodError`                            |
| 10  | `pinned` omitted → accepts            | Omit `pinned`                                | Parses, `pinned` is `undefined`       |
| 11  | Minimal valid object                  | `{ id, text, author: {id, login}, created }` | Parses                                |
| 12  | Full valid with all optionals         | All fields populated                         | Parses, all fields present            |
| 13  | Empty `text` → accepts (no `.min(1)`) | `text: ''`                                   | Parses with empty string              |

**Acceptance Criteria:**

- [ ] ≥13 tests total (up from 1)
- [ ] All 3 required fields tested for rejection on absence
- [ ] Nested `author` schema validation tested (missing subfield)

---

### Task 3.1.4 — `tag.test.ts` (TagSchema)

**Current:** 2 tests — happy path + null color.

#### Schema field analysis:

**TagSchema** fields:

- `id` (required, string)
- `$type` (optional, string)
- `name` (required, string)
- `color` (nullable + optional — `.nullable().optional()`)
  - When present: `{ $type?, id?, background (required), foreground? }`
- `untagOnResolve` (optional, boolean)
- `owner` (optional, `{ id: string }`)

#### New tests to add:

| #   | Test Description                                | Input Mutation                  | Expected                                  |
| --- | ----------------------------------------------- | ------------------------------- | ----------------------------------------- |
| 1   | Missing `name` → rejects                        | Omit `name`                     | `ZodError` path `['name']`                |
| 2   | Missing `id` → rejects                          | Omit `id`                       | `ZodError` path `['id']`                  |
| 3   | `name` as number → rejects                      | `name: 123`                     | `ZodError`                                |
| 4   | `color` as `undefined` → accepts                | Omit `color`                    | Parses, `color` is `undefined`            |
| 5   | `color` missing required `background` → rejects | `color: { id: '1' }`            | `ZodError` path `['color', 'background']` |
| 6   | `color` with only `background` → accepts        | `color: { background: '#FFF' }` | Parses                                    |
| 7   | `color.foreground` as number → rejects          | `foreground: 42`                | `ZodError`                                |
| 8   | `untagOnResolve` as string → rejects            | `untagOnResolve: 'yes'`         | `ZodError`                                |
| 9   | `owner` with valid id → accepts                 | `owner: { id: 'u-1' }`          | Parses                                    |
| 10  | `owner` missing `id` → rejects                  | `owner: {}`                     | `ZodError`                                |
| 11  | Minimal valid                                   | `{ id: '1', name: 'Bug' }`      | Parses                                    |

**Acceptance Criteria:**

- [ ] ≥11 tests total (up from 2)
- [ ] Nullable + optional distinction for `color` thoroughly verified (`null`, `undefined`, and invalid object)
- [ ] Nested `color` object sub-field validation tested

---

### Task 3.1.5 — `project.test.ts` (ProjectSchema)

**Current:** 2 tests — happy path + minimal valid.

#### Schema field analysis:

**ProjectSchema** fields:

- `id` (required, string)
- `$type` (optional, string)
- `name` (required, string)
- `shortName` (required, string)
- `description` (optional, string)
- `archived` (optional, boolean)
- `leader` (optional, lazy UserSchema)
- `createdBy` (optional, lazy UserSchema)
- `created` (optional, TimestampSchema)

#### New tests to add:

| #   | Test Description                                           | Input Mutation                       | Expected                        |
| --- | ---------------------------------------------------------- | ------------------------------------ | ------------------------------- |
| 1   | Missing `name` → rejects                                   | Omit `name`                          | `ZodError` path `['name']`      |
| 2   | Missing `shortName` → rejects                              | Omit `shortName`                     | `ZodError` path `['shortName']` |
| 3   | Missing `id` → rejects                                     | Omit `id`                            | `ZodError` path `['id']`        |
| 4   | `name` as number → rejects                                 | `name: 42`                           | `ZodError`                      |
| 5   | `shortName` as number → rejects                            | `shortName: 42`                      | `ZodError`                      |
| 6   | `archived` as string → rejects                             | `archived: 'true'`                   | `ZodError`                      |
| 7   | `description` as `null` → rejects (optional, not nullable) | `description: null`                  | `ZodError`                      |
| 8   | `leader` with valid user → accepts                         | `leader: { id, login, fullName }`    | Parses                          |
| 9   | `leader` with invalid user (missing `login`) → rejects     | `leader: { id: '1', fullName: 'X' }` | `ZodError`                      |
| 10  | `created` as ISO string → rejects                          | `created: '2024-01-01'`              | `ZodError`                      |
| 11  | Minimal valid (only `id`, `name`, `shortName`)             | `{ id, name, shortName }`            | Parses                          |
| 12  | Extra fields stripped                                      | `{ ...valid, custom: true }`         | Parses, no `custom` key         |

**Acceptance Criteria:**

- [ ] ≥12 tests total (up from 2)
- [ ] All 3 required fields tested for rejection
- [ ] Nested `leader`/`createdBy` lazy schema rejection tested

---

### Task 3.1.6 — `issue-link.test.ts` (IssueLinkSchema)

**Current:** 1 test — happy path with all fields populated.

#### Schema field analysis:

**IssueLinkSchema** fields (all optional except none required at root):

- `id` (optional, string)
- `$type` (optional, string)
- `direction` (optional, string)
- `linkType` (optional, IssueLinkTypeSchema)
  - `id` (required, string — from BaseEntitySchema)
  - `name` (required, string)
  - `directed` (optional, boolean)
  - `aggregation` (optional, boolean)
  - `sourceToTarget` (optional, string)
  - `targetToSource` (optional, string)
  - `localizedName` (optional, string)
  - `localizedSourceToTarget` (optional, string)
  - `localizedTargetToSource` (optional, string)
- `issues` (optional, array of `{ id (required), idReadable?, summary? }`)

**Note:** This schema is unusually permissive — almost everything is optional. Focus tests on nested structure validation.

#### New tests to add:

| #   | Test Description                                        | Input                                                   | Expected                               |
| --- | ------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| 1   | Empty object → accepts (all optional)                   | `{}`                                                    | Parses                                 |
| 2   | `linkType` missing `name` → rejects                     | `{ linkType: { id: '1' } }`                             | `ZodError` path `['linkType', 'name']` |
| 3   | `linkType` missing `id` → rejects                       | `{ linkType: { name: 'Relates' } }`                     | `ZodError` path `['linkType', 'id']`   |
| 4   | `issues` with invalid item (missing `id`) → rejects     | `{ issues: [{ summary: 'x' }] }`                        | `ZodError` path `['issues', 0, 'id']`  |
| 5   | `issues` empty array → accepts                          | `{ issues: [] }`                                        | Parses                                 |
| 6   | `issues` item with only `id` → accepts                  | `{ issues: [{ id: '1' }] }`                             | Parses                                 |
| 7   | `direction` as number → rejects                         | `{ direction: 1 }`                                      | `ZodError`                             |
| 8   | `linkType.directed` as string → rejects                 | `{ linkType: { id: '1', name: 'X', directed: 'yes' } }` | `ZodError`                             |
| 9   | Multiple issues in array → accepts                      | `{ issues: [{ id: '1' }, { id: '2' }] }`                | Parses with 2 items                    |
| 10  | `linkType` with all optional fields populated → accepts | Full `linkType` object                                  | Parses, all fields present             |

**Acceptance Criteria:**

- [ ] ≥10 tests total (up from 1)
- [ ] Nested `linkType` sub-schema required fields tested
- [ ] `issues` array item validation tested

---

### Task 3.1.7 — `issue.test.ts` (IssueSchema + IssueListSchema)

**Current:** 1 test — happy path for `IssueSchema` only. `IssueListSchema` has **zero coverage**.

#### Schema field analysis:

**IssueSchema** fields:

- `id` (required), `$type` (optional) — from BaseEntitySchema
- `idReadable` (required, string)
- `summary` (required, string)
- `description` (optional, string)
- `project` (required, extended BaseEntitySchema with optional `name`, `shortName`)
- `reporter` (optional, lazy UserSchema)
- `updater` (optional, lazy UserSchema)
- `created` (required, TimestampSchema)
- `updated` (required, TimestampSchema)
- `resolved` (optional, TimestampSchema)
- `customFields` (required, array of CustomFieldValueSchema)
- `tags` (optional, array of lazy TagSchema)
- `links` (optional, array of IssueLinkSchema)
- `commentsCount` (optional, number)
- `votes` (optional, number)

**IssueListSchema** fields:

- `id` (required, string)
- `$type` (optional, string)
- `idReadable` (optional, string)
- `summary` (required, string)
- `project` (optional, extended BaseEntitySchema with optional `name`, `shortName`)
- `customFields` (optional, array of CustomFieldValueSchema)

#### New tests to add:

**IssueSchema:**
| # | Test Description | Input Mutation | Expected |
|---|-----------------|----------------|----------|
| 1 | Missing `idReadable` → rejects | Omit `idReadable` | `ZodError` |
| 2 | Missing `summary` → rejects | Omit `summary` | `ZodError` |
| 3 | Missing `project` → rejects | Omit `project` | `ZodError` |
| 4 | Missing `created` → rejects | Omit `created` | `ZodError` |
| 5 | Missing `updated` → rejects | Omit `updated` | `ZodError` |
| 6 | Missing `customFields` → rejects | Omit `customFields` | `ZodError` |
| 7 | `project` missing `id` → rejects | `project: { name: 'P' }` | `ZodError` |
| 8 | `customFields` as empty array → accepts | `customFields: []` | Parses |
| 9 | `tags` as empty array → accepts | `tags: []` | Parses |
| 10 | `links` as empty array → accepts | `links: []` | Parses |
| 11 | `commentsCount` as string → rejects | `commentsCount: 'five'` | `ZodError` |
| 12 | `resolved` as `null` → rejects (optional, not nullable) | `resolved: null` | `ZodError` |
| 13 | Minimal valid issue | Only required fields | Parses |

**IssueListSchema:**
| # | Test Description | Input | Expected |
|---|-----------------|-------|----------|
| 14 | Valid list item | `{ id, summary }` | Parses |
| 15 | Missing `id` → rejects | `{ summary: 'x' }` | `ZodError` |
| 16 | Missing `summary` → rejects | `{ id: '1' }` | `ZodError` |
| 17 | `idReadable` omitted → accepts | `{ id: '1', summary: 'x' }` | Parses |
| 18 | `project` omitted → accepts | `{ id: '1', summary: 'x' }` | Parses |
| 19 | `customFields` omitted → accepts | `{ id: '1', summary: 'x' }` | Parses |
| 20 | Full list item with all optionals | All fields | Parses |

**Acceptance Criteria:**

- [ ] ≥20 tests total (up from 1)
- [ ] Both `IssueSchema` and `IssueListSchema` tested
- [ ] All 6 required fields of `IssueSchema` tested for rejection on absence
- [ ] import updated to include `IssueListSchema`

---

### Task 3.1.8 — NEW `custom-fields.test.ts` (CustomFieldValueSchema)

**Current:** No test file exists. This is a discriminated union of 7 variants used by every `IssueSchema` parse.

#### Schema variants (discriminated by `$type`):

| Variant                         | `$type` literal                | `value` type                                     |
| ------------------------------- | ------------------------------ | ------------------------------------------------ | ------ | ------------------- |
| `SingleEnumIssueCustomField`    | `'SingleEnumIssueCustomField'` | `{ $type: 'EnumBundleElement', name, ordinal? }` |
| `MultiEnumIssueCustomField`     | `'MultiEnumIssueCustomField'`  | `Array<EnumBundleElement>`                       |
| `SingleUserIssueCustomField`    | `'SingleUserIssueCustomField'` | `UserReferenceSchema` (optional)                 |
| `MultiUserIssueCustomField`     | `'MultiUserIssueCustomField'`  | `Array<UserReferenceSchema>` (optional)          |
| `TextIssueCustomField`          | `'TextIssueCustomField'`       | `{ $type: 'TextFieldValue', text }`              |
| `SimpleIssueCustomField`        | `'SimpleIssueCustomField'`     | `string                                          | number | boolean` (optional) |
| `UnknownIssueCustomFieldSchema` | any other string               | `unknown` (fallback)                             |

#### Tests to create:

| #   | Test Description                                                     | Input                                                                                                            | Expected                                   |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | `SingleEnumIssueCustomField` happy path                              | `{ $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { $type: 'EnumBundleElement', name: 'High' } }` | Parses                                     |
| 2   | `SingleEnumIssueCustomField` missing `name` → rejects                | Omit `name`                                                                                                      | `ZodError`                                 |
| 3   | `SingleEnumIssueCustomField` value missing `$type` literal → rejects | `value: { name: 'High' }`                                                                                        | `ZodError`                                 |
| 4   | `SingleEnumIssueCustomField` value with `ordinal` → accepts          | `value: { ..., ordinal: 1 }`                                                                                     | Parses                                     |
| 5   | `MultiEnumIssueCustomField` happy path (2 elements)                  | Valid array of EnumBundleElements                                                                                | Parses                                     |
| 6   | `MultiEnumIssueCustomField` empty array → accepts                    | `value: []`                                                                                                      | Parses                                     |
| 7   | `SingleUserIssueCustomField` happy path                              | `value: { id: '1', login: 'john' }`                                                                              | Parses                                     |
| 8   | `SingleUserIssueCustomField` `value` omitted → accepts (optional)    | Omit `value`                                                                                                     | Parses                                     |
| 9   | `MultiUserIssueCustomField` happy path                               | Array of UserReferences                                                                                          | Parses                                     |
| 10  | `MultiUserIssueCustomField` `value` omitted → accepts                | Omit `value`                                                                                                     | Parses                                     |
| 11  | `TextIssueCustomField` happy path                                    | `value: { $type: 'TextFieldValue', text: 'Hello' }`                                                              | Parses                                     |
| 12  | `TextIssueCustomField` value missing `text` → rejects                | `value: { $type: 'TextFieldValue' }`                                                                             | `ZodError`                                 |
| 13  | `SimpleIssueCustomField` with string value                           | `value: 'hello'`                                                                                                 | Parses                                     |
| 14  | `SimpleIssueCustomField` with number value                           | `value: 42`                                                                                                      | Parses                                     |
| 15  | `SimpleIssueCustomField` with boolean value                          | `value: true`                                                                                                    | Parses                                     |
| 16  | `SimpleIssueCustomField` with `value` omitted                        | Omit `value`                                                                                                     | Parses                                     |
| 17  | Unknown `$type` falls through to fallback                            | `{ $type: 'PeriodIssueCustomField', name: 'X', value: { ... } }`                                                 | Parses via `UnknownIssueCustomFieldSchema` |
| 18  | Missing `$type` entirely → rejects all branches                      | `{ name: 'X', value: 'y' }`                                                                                      | `ZodError`                                 |
| 19  | Missing `name` on any variant → rejects                              | `{ $type: 'SimpleIssueCustomField', value: 1 }`                                                                  | `ZodError`                                 |

**Acceptance Criteria:**

- [ ] New file `tests/providers/youtrack/schemas/custom-fields.test.ts` created
- [ ] ≥19 tests covering all 7 union variants
- [ ] Fallback `UnknownIssueCustomFieldSchema` explicitly tested
- [ ] Missing discriminator `$type` tested

---

### Task 3.1 Summary

| File                    | Current Tests | Target Tests | Net New |
| ----------------------- | :-----------: | :----------: | :-----: |
| `common.test.ts`        |       2       |     ≥12      |   +10   |
| `user.test.ts`          |       3       |     ≥13      |   +10   |
| `comment.test.ts`       |       1       |     ≥13      |   +12   |
| `tag.test.ts`           |       2       |     ≥11      |   +9    |
| `project.test.ts`       |       2       |     ≥12      |   +10   |
| `issue-link.test.ts`    |       1       |     ≥10      |   +9    |
| `issue.test.ts`         |       1       |     ≥20      |   +19   |
| `custom-fields.test.ts` |       0       |     ≥19      |   +19   |
| **Total**               |    **12**     |   **≥110**   | **+98** |

**Estimated effort:** 5–6h

---

## Task 3.2 — Kaneo Client Header Verification

### Current State

`tests/providers/kaneo/client.test.ts` has 10 tests. Two tests capture `capturedOptions` and assert `headers` "exist" (`toBeDefined()`) but **never verify actual header values**:

1. **"makes GET request with correct headers"** — asserts `capturedOptions?.headers` is defined, never checks `Authorization: Bearer test-key`
2. **"uses session cookie when provided"** — asserts `capturedOptions?.headers` is defined, never checks `Cookie: better-auth.session_token=abc123`

### Tests to add/modify:

| #   | Test Description                                                                        | Setup                                               | Assertion                                                       |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| 1   | **Fix** "makes GET request with correct headers" — verify `Authorization` value         | `apiKey: 'test-key'`, no `sessionCookie`            | `headers['Authorization']` equals `'Bearer test-key'`           |
| 2   | **Fix** "uses session cookie when provided" — verify `Cookie` value                     | `sessionCookie: 'better-auth.session_token=abc123'` | `headers['Cookie']` equals `'better-auth.session_token=abc123'` |
| 3   | **Fix** "uses session cookie" — verify `Authorization` is **absent** when cookie is set | Same as above                                       | `headers['Authorization']` is `undefined`                       |
| 4   | **Add** GET request has `Content-Type: application/json`                                | Standard GET                                        | `headers['Content-Type']` equals `'application/json'`           |
| 5   | **Add** POST request sends `Content-Type: application/json`                             | POST with body                                      | `headers['Content-Type']` equals `'application/json'`           |
| 6   | **Add** PUT request sends correct method + headers                                      | PUT with body                                       | `capturedOptions.method` is `'PUT'`, headers present            |
| 7   | **Add** PATCH request sends correct method + headers                                    | PATCH with body                                     | `capturedOptions.method` is `'PATCH'`, headers present          |

### Implementation approach:

For tests 1–3, modify existing tests to replace `toBeDefined()` with value assertions. For tests 4–7, add new test cases.

The `capturedOptions.headers` is typed as `Record<string, string>` in the source, so header values can be accessed directly by key.

**Acceptance Criteria:**

- [ ] No test asserts only `toBeDefined()` on headers — all verify actual values
- [ ] `Authorization: Bearer <key>` verified for API key auth
- [ ] `Cookie: <cookie>` verified for session cookie auth
- [ ] Mutual exclusivity tested: when cookie is set, `Authorization` header is absent
- [ ] PUT and PATCH methods have dedicated tests
- [ ] `Content-Type: application/json` verified on at least POST

**Estimated effort:** 1h

---

## Task 3.3 — Add `await` to `expect().rejects` Across All Test Files

### Problem

Without `await`, `expect(promise).rejects.toThrow()` returns a Promise that is **never awaited**. The test passes regardless of whether the promise actually rejects. This is a false-confidence pattern — if the underlying code stops throwing, the test still passes silently.

Most instances also have a companion `await promise.catch(() => {})` line that prevents unhandled rejection warnings but does not fix the core issue.

### Current State — Full Inventory

**34 instances across 17 files:**

| File                                              | Missing `await` Count | Has companion `catch`? |
| ------------------------------------------------- | :-------------------: | :--------------------: |
| `tests/providers/kaneo/client.test.ts`            |           2           |        Yes (2)         |
| `tests/providers/kaneo/column-resource.test.ts`   |           3           |        Yes (3)         |
| `tests/providers/kaneo/comment-resource.test.ts`  |           4           |        Yes (4)         |
| `tests/providers/kaneo/label-resource.test.ts`    |           7           |        Yes (7)         |
| `tests/providers/kaneo/project-resource.test.ts`  |           5           |        Yes (5)         |
| `tests/providers/kaneo/schema-validation.test.ts` |           6           |        Yes (6)         |
| `tests/providers/kaneo/task-relations.test.ts`    |           7           |        Yes (7)         |
| **Kaneo subtotal**                                |        **34**         |         **34**         |
| `tests/tools/comment-tools.test.ts`               |           4           |         Check          |
| `tests/tools/label-tools.test.ts`                 |           4           |         Check          |
| `tests/tools/project-tools.test.ts`               |           4           |         Check          |
| `tests/tools/status-tools.test.ts`                |           6           |         Check          |
| `tests/tools/task-label-tools.test.ts`            |           4           |         Check          |
| `tests/tools/task-relation-tools.test.ts`         |           4           |         Check          |
| `tests/tools/task-tools.test.ts`                  |           5           |         Check          |
| `tests/providers/youtrack/provider.test.ts`       |           1           |         Check          |
| `tests/e2e/error-handling.test.ts`                |           2           |         Check          |
| `tests/e2e/task-relations.test.ts`                |           1           |         Check          |
| **Non-Kaneo subtotal**                            |        **35**         |           —            |
| **Grand total**                                   |        **~70**        |           —            |

> Note: The roadmap scoped Task 3.3 to `tests/providers/kaneo/` only. This plan recommends **expanding scope to all 17 files** since the fix is mechanical and the risk of false-confidence is identical everywhere.

### Fix Pattern

**Before:**

```typescript
const promise = someAsyncCall()
expect(promise).rejects.toThrow('error message')
await promise.catch(() => {})
```

**After:**

```typescript
const promise = someAsyncCall()
await expect(promise).rejects.toThrow('error message')
```

Two changes per instance:

1. Add `await` before `expect(promise).rejects`
2. Remove the companion `await promise.catch(() => {})` line (if present)

### Implementation approach:

This is a mechanical, file-by-file find-and-replace. Suggested order:

#### Batch 1 — Kaneo provider tests (34 instances, 7 files)

- [ ] **3.3.1** `client.test.ts` — 2 fixes
- [ ] **3.3.2** `column-resource.test.ts` — 3 fixes
- [ ] **3.3.3** `comment-resource.test.ts` — 4 fixes
- [ ] **3.3.4** `label-resource.test.ts` — 7 fixes
- [ ] **3.3.5** `project-resource.test.ts` — 5 fixes
- [ ] **3.3.6** `schema-validation.test.ts` — 6 fixes
- [ ] **3.3.7** `task-relations.test.ts` — 7 fixes

#### Batch 2 — Tool tests (31 instances, 7 files)

- [ ] **3.3.8** `comment-tools.test.ts` — 4 fixes
- [ ] **3.3.9** `label-tools.test.ts` — 4 fixes
- [ ] **3.3.10** `project-tools.test.ts` — 4 fixes
- [ ] **3.3.11** `status-tools.test.ts` — 6 fixes
- [ ] **3.3.12** `task-label-tools.test.ts` — 4 fixes
- [ ] **3.3.13** `task-relation-tools.test.ts` — 4 fixes
- [ ] **3.3.14** `task-tools.test.ts` — 5 fixes

#### Batch 3 — Other tests (4 instances, 3 files)

- [ ] **3.3.15** `providers/youtrack/provider.test.ts` — 1 fix
- [ ] **3.3.16** `e2e/error-handling.test.ts` — 2 fixes
- [ ] **3.3.17** `e2e/task-relations.test.ts` — 1 fix

### Verification

After all fixes:

```bash
# Confirm zero remaining instances
grep -rn 'expect(.*).rejects\.' tests/ | grep -v 'await expect' | wc -l
# Expected: 0

# Confirm zero remaining companion catch workarounds
grep -rn 'await promise.catch' tests/ | wc -l
# Expected: 0

# Full test suite passes
bun test
```

**Acceptance Criteria:**

- [ ] Zero `expect(promise).rejects` without `await` in the entire `tests/` directory
- [ ] Zero `await promise.catch(() => {})` workaround lines remaining
- [ ] `bun test` green — no regressions

**Estimated effort:** 2–3h

---

## Risk Assessment Matrix

| Risk                                                                                                              | Probability |   Impact   | Mitigation                                                                                                               | Owner |
| ----------------------------------------------------------------------------------------------------------------- | :---------: | :--------: | ------------------------------------------------------------------------------------------------------------------------ | ----- |
| Adding `await` to `expect().rejects` reveals tests that were silently passing (promise wasn't actually rejecting) |  **High**   | **Medium** | Run tests after each batch; fix any newly-failing tests by correcting the setup, not by removing the `await`             | Dev   |
| Zod `.strip()` behavior changes on upgrade (extra-field test assumptions)                                         |   **Low**   |  **Low**   | Pin Zod version; document that Zod v3 strips by default on `.object()`                                                   | Dev   |
| `z.lazy()` in `CommentSchema.author` and `IssueSchema.reporter` causes test complexity for circular references    | **Medium**  |  **Low**   | Test with simple valid sub-objects; don't exercise deep circular nesting                                                 | Dev   |
| `CustomFieldValueSchema` union ordering affects which branch Zod tries first                                      |   **Low**   | **Medium** | Test the fallback `UnknownIssueCustomFieldSchema` explicitly; verify unknown `$type` values don't match earlier branches | Dev   |
| Large number of mechanical `await` fixes across 17 files risks typos                                              | **Medium**  |  **Low**   | Use search-and-replace with manual review; run `bun test` after each batch                                               | Dev   |

---

## Execution Order

```
Task 3.3 (await fixes)  ←  Do FIRST: mechanical, unblocks accurate test results
├── Batch 1: Kaneo provider (7 files)
├── Batch 2: Tool tests (7 files)
├── Batch 3: Other tests (3 files)
│
Task 3.2 (Kaneo client headers)  ←  Quick win, independent
│
Task 3.1 (YouTrack schemas)  ←  Largest effort, do last
├── 3.1.1 common.test.ts
├── 3.1.2 user.test.ts
├── 3.1.3 comment.test.ts
├── 3.1.4 tag.test.ts
├── 3.1.5 project.test.ts
├── 3.1.6 issue-link.test.ts
├── 3.1.7 issue.test.ts
└── 3.1.8 custom-fields.test.ts (NEW file)
```

**Rationale:** Fix `await` first because it may reveal silently-passing tests that affect other tasks. Kaneo client headers is a small, standalone win. Schema expansion is the bulk of the work and benefits from the confidence that rejection tests actually run.

---

## Phase 3 Definition of Done

- [ ] Each YouTrack schema file has ≥8 tests (currently 1–3 each)
- [ ] New `custom-fields.test.ts` covers all 7 union variants
- [ ] `IssueListSchema` has dedicated test coverage (currently zero)
- [ ] Kaneo client tests verify exact header **values**, not just existence
- [ ] PUT and PATCH HTTP methods are tested in client
- [ ] Zero `expect().rejects` without `await` in the entire codebase (currently ~70)
- [ ] Zero `await promise.catch(() => {})` workaround lines remaining
- [ ] `bun test` green
- [ ] No `eslint-disable`, `@ts-ignore`, or `@ts-nocheck`

---

## Success Metrics

| Metric                                      | Before Phase 3 | After Phase 3 |
| ------------------------------------------- | :------------: | :-----------: |
| YouTrack schema tests                       |       12       |     ≥110      |
| Schema files with ≤3 tests                  |     7 of 7     |    0 of 8     |
| `IssueListSchema` test coverage             |       0        |   ≥7 tests    |
| `CustomFieldValueSchema` test coverage      |       0        |   ≥19 tests   |
| Kaneo client header value assertions        |       0        |      ≥5       |
| Missing `await` on `expect().rejects`       |      ~70       |       0       |
| `await promise.catch(() => {})` workarounds |      ~34       |       0       |
| Average schema file score                   |     4.4/10     |     ≥7/10     |
