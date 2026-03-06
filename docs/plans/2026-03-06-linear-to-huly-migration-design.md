# Linear to Huly Migration Design

**Date:** 2026-03-06

## Overview

Replace Linear issue tracking integration with Huly Platform API while preserving all existing functionality and tool interfaces.

## Architecture

### Before

```
Telegram → Tools → @linear/sdk → Linear GraphQL API
```

### After

```
Telegram → Tools → @hcengineering/api-client → Huly WebSocket API
```

The directory `src/linear/` will be renamed to `src/huly/` after migration completion. All 22 tool files maintain identical interfaces—only internal implementations change.

## Configuration

### Environment Variables (Deployment-Wide)

- `HULY_URL` - Huly instance URL (from `HULY_HOST_ADDRESS`)
- `HULY_WORKSPACE` - Single workspace for this deployment

### Per-User Configuration (SQLite)

- `huly_email` - User's Huly login email
- `huly_password` - User's Huly password

**Removed:** `linear_key`, `linear_team_id`

## Project Model

### Auto-Creation

When a user first executes any Huly operation:

1. Check if project exists for user
2. Auto-create default project with identifier: `P-{username}` or `P-{userId}`
3. Use this as default for all operations

### Multi-Project Support

Users can create additional projects via `create_project` tool and switch between them by specifying `projectId` in tool calls. All 4 project management tools are preserved.

## Implementation Changes

### Authentication

Replace `LinearClient` singleton with per-operation `connect()`:

```typescript
const client = await connect(HULY_URL, {
  email: getConfig(userId, 'huly_email'),
  password: getConfig(userId, 'huly_password'),
  workspace: HULY_WORKSPACE,
})
```

### Data Mapping

| Linear Concept   | Huly Equivalent                                     |
| ---------------- | --------------------------------------------------- |
| `LinearClient`   | `connect()` from `@hcengineering/api-client`        |
| `Issue`          | `tracker.class.Issue` via `addCollection`           |
| `Project`        | `tracker.class.Project` via `createDoc`             |
| `Label`          | `tags.class.TagElement` + `tags.class.TagReference` |
| `teamId`         | `projectId` (space identifier)                      |
| Issue identifier | `${project.identifier}-${sequence}`                 |

### File-Level Changes

Each file in `src/linear/` is rewritten:

**create-issue.ts:**

- Before: `client.createIssue({ teamId, ... })`
- After: `client.addCollection(tracker.class.Issue, projectId, ...)`

**search-issues.ts:**

- Before: `client.searchIssues(query)`
- After: `client.findAll(tracker.class.Issue, { space: projectId, ... })`

**list-projects.ts:**

- Before: `client.projects()`
- After: `client.findAll(tracker.class.Project, {})`

## Tool Preservation

All 22 tools maintain identical Zod schemas and return types:

- `create_issue`, `update_issue`, `search_issues`, `get_issue`, `archive_issue`
- `create_project`, `update_project`, `archive_project`, `list_projects`
- `create_label`, `update_label`, `remove_label`, `list_labels`
- `add_issue_label`, `remove_issue_label`
- `add_issue_comment`, `get_issue_comments`, `update_issue_comment`, `remove_issue_comment`
- `add_issue_relation`, `update_issue_relation`, `remove_issue_relation`

## Error Handling

Replace `classifyLinearError` with Huly-specific error classification in `src/linear/classify-error.ts` (later `src/huly/classify-error.ts`).

## Migration Steps

1. Add `@hcengineering/api-client`, `@hcengineering/core`, `@hcengineering/tracker` dependencies
2. Update `src/config.ts` - replace Linear keys with Huly keys
3. Rewrite all 22 files in `src/linear/`
4. Update error classifier
5. Remove `@linear/sdk` dependency
6. Rename `src/linear/` to `src/huly/`
7. Update all imports

## Testing Strategy

- All existing tests in `tests/linear/` and `tests/tools/` must pass with Huly mocks
- Update mock files to return Huly-shaped responses
- Integration test: verify connection, project creation, and basic CRUD operations

## Rollback Plan

If migration fails:

1. Revert to previous commit
2. Linear integration remains functional
3. No data loss (Huly is separate instance)

## Success Criteria

- [ ] All 22 tools work identically from user perspective
- [ ] Users can configure Huly via `/set` commands
- [ ] Default projects auto-create on first use
- [ ] All existing tests pass
- [ ] No breaking changes to Telegram bot UX
