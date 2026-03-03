# Linear API Response Validation Implementation Plan

**Roadmap task:** Linear API response validation — add null checks and handle missing fields from API responses

## Goal

Harden `src/linear/*` wrappers so unexpected `null`/missing fields from Linear API responses are handled explicitly (with clear logs and predictable outcomes) instead of causing implicit runtime failures.

## Research Summary (Current State)

### Existing protections

- Mutation wrappers already check for missing top-level payload entities in several places:
  - `src/linear/add-comment.ts` (`if (!comment)`)
  - `src/linear/create-label.ts` (`if (!label)`)
  - `src/linear/create-project.ts` (`if (!project)`)
  - `src/linear/create-relation.ts` (`if (!relation)`)
- Errors are centralized through `classifyLinearError` and logged consistently.

### Gaps to address

- Multiple read/update paths assume required entities always exist:
  - `src/linear/get-issue.ts` uses `issue.state` and `issue.assignee` without guarding missing `issue`.
  - `src/linear/get-comments.ts`, `src/linear/get-relations.ts`, `src/linear/get-issue-labels.ts` call methods on `issue` without null checks.
  - `src/linear/update-issue.ts` uses `issue.team` without checking for missing `issue`.
  - `src/linear/list-labels.ts` assumes `client.team(teamId)` always returns a team.
- Collection mapping assumes stable node shape:
  - `src/linear/list-projects.ts`, `src/linear/list-labels.ts`, `src/linear/get-issue-labels.ts`, `src/linear/get-comments.ts` directly map `nodes`.
  - `src/linear/search-issues.ts` uses non-null assertion (`issue!`) after `filter(Boolean)`.
- The roadmap item specifically requires explicit handling of API response shape problems; current behavior mostly relies on thrown exceptions from property access.

## Requirements

1. Add explicit null checks before dereferencing objects returned by Linear SDK (issue/team/state/list nodes).
2. Handle missing required fields from API responses without unsafe non-null assertions.
3. Preserve current public function contracts and return shapes in `src/linear/*`.
4. Log validation anomalies with `logger.warn` (recoverable/partial data) and `logger.error` (operation failure).
5. Route fatal validation failures through deterministic classification (avoid ambiguous substring-only matching): either throw `LinearApiError` with explicit `appError`, or extend `classifyLinearError` with dedicated response-shape rules.
6. Add focused tests for new response-validation behavior (if adding tests is practical in current project setup).

## Implementation Plan

### 1) Add a small shared response-guard utility

- Create a minimal helper in `src/linear/` (for example `response-guards.ts`) for common checks:
  - required entity present
  - required string field present/non-empty
  - optional list node filtering with logging
- Keep helper small and local to avoid broad refactors.

### 2) Guard entity fetches before property access

- Update wrappers to check entity existence immediately after SDK reads:
  - `get-issue.ts`
  - `get-comments.ts`
  - `get-relations.ts`
  - `get-issue-labels.ts`
  - `update-issue.ts` (inside workflow state resolution)
  - `list-labels.ts` (team fetch)
- On missing required entity: throw a typed, explicit error (`LinearApiError`/`AppError`) or a deterministically recognizable error shape (not free-form ambiguous strings like "issue").

### 3) Guard list-node mapping and field extraction

- Replace unsafe assumptions during `nodes.map(...)`:
  - Skip malformed/empty nodes with `logger.warn` and continue where safe.
  - Remove non-null assertion in `search-issues.ts` by using typed narrowing.
- Ensure each returned object is built only from validated fields required by current return type.

### 4) Add targeted tests for validation paths

- Add minimal tests around new guards/normalizers and at least one wrapper behavior for:
  - missing top-level entity
  - malformed list node skipped safely
  - valid responses still map exactly as before
- Keep tests tightly scoped to new validation logic.

### 5) Verify and document outcomes

- Run repository lint/format checks.
- Confirm no unrelated files changed.
- Keep plan execution changes minimal and localized to `src/linear/*` (+ optional tests).

## Acceptance Criteria

- [ ] No `src/linear/*` function dereferences API-returned entities without null checks.
- [ ] `search-issues.ts` no longer relies on non-null assertion for filtered issues.
- [ ] Missing required entities (issue/team/etc.) produce controlled, classified failures instead of implicit runtime type errors.
- [ ] Response-shape validation failures are classified deterministically (not by broad substring matches that can misclassify errors).
- [ ] Malformed optional list items are skipped safely with warning logs and without crashing the operation.
- [ ] Existing successful-path return shapes for all Linear wrappers remain unchanged.
- [ ] Lint/format checks pass for changed files.
