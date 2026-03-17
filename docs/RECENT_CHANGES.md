# Recent Changes (March 2026)

## Summary

This document summarizes recent changes to the papai codebase.

## 2026-03-17: In-Memory Cache System

**Commit**: (multiple commits leading to aaeb245)

**Feature**: Added comprehensive in-memory caching layer for better performance.

**Changes**:

- Added `src/cache.ts` - In-memory user session cache with TTL (295 lines)
  - Caches: history, summary, facts, config, workspaceId, tools
  - Auto-expires after 30 minutes of inactivity
  - Background sync to SQLite via `queueMicrotask`
- Added `src/cache-helpers.ts` - Helper functions for parsing conversation history JSON
- Migrated `src/history.ts`, `src/memory.ts`, `src/config.ts` to use cache layer

**Files Changed**:

- `src/cache.ts` (new)
- `src/cache-helpers.ts` (new)
- `src/history.ts` (refactored)
- `src/memory.ts` (refactored)
- `src/config.ts` (refactored via cache)

## 2026-03-17: API Schema Refactoring

**Commit**: (multiple commits)

**Feature**: Migrated to auto-generated Zod schemas from OpenAPI spec.

**Changes**:

- Added `src/kaneo/schemas/` directory with 70+ Zod schema files
  - Request/response schemas for all API endpoints
  - Includes: tasks, projects, labels, columns, comments, activities, etc.
- Removed `src/kaneo/request-schemas.ts` (consolidated into schemas/)
- Updated all kaneo resource files to use new schemas
- Added `src/kaneo/schemas/api-compat.ts` for API compatibility layer

**Files Changed**:

- `src/kaneo/schemas/*.ts` (70+ new files)
- `src/kaneo/request-schemas.ts` (deleted)
- `src/kaneo/*-resource.ts` (updated)

## 2026-03-17: Task Management Improvements

**Commit**: (multiple commits)

**Changes**:

- Added `src/kaneo/task-update-helpers.ts` - Helper functions for task update operations
- Added `src/kaneo/task-status.ts` - Task status/column management helpers
- Fixed default task status to 'todo' instead of 'to-do'
- Improved task relation handling via frontmatter
- Better error classification for task operations

**Files Changed**:

- `src/kaneo/task-update-helpers.ts` (new)
- `src/kaneo/task-status.ts` (new)
- `src/kaneo/task-resource.ts` (updated)
- `src/kaneo/create-task.ts` (updated)

## 2026-03-17: Conversation History Fix

**Commit**: `714a76e`

**Problem**: Assistant responses were not being persisted to conversation history, breaking multi-turn conversation context.

**Changes**:

- Modified `callLlm` in `src/bot.ts` to return LLM result
- Modified `processMessage` to append assistant responses to history after successful LLM call
- Moved trim trigger check to after both user and assistant messages are saved

**Files Changed**:

- `src/bot.ts`

## 2026-03-16: Context Command

**Commit**: `8389b52`, `a7ceacb`, `5f4e46d`

**Feature**: Added `/context` admin command to export conversation context.

**Changes**:

- Added `src/commands/context.ts` - exports history, summary, and facts as text file
- Command is admin-only (restricted to `TELEGRAM_USER_ID`)
- Fixed memory leak in `clearFacts()` to also clear in-memory cache

**Files Changed**:

- `src/commands/context.ts` (new)
- `src/commands/index.ts`
- `src/bot.ts`
- `src/memory.ts`

## 2026-03-16: Version Announcements

**Commit**: `31e5bd1`, `8fd01d2`, `c17f8e8`

**Feature**: Automatic version announcements to users on bot startup.

**Changes**:

- Added `src/announcements.ts` - checks and sends version announcements
- Added `src/changelog-reader.ts` - reads CHANGELOG.md for version info
- Added `src/db/migrations/006_version_announcements.ts` - database migration
- Added `tests/announcements.test.ts` - comprehensive test suite
- Announcements use formatted entities (Markdown → Telegram entities)

**Files Changed**:

- `src/announcements.ts` (new)
- `src/changelog-reader.ts` (new)
- `src/db/migrations/006_version_announcements.ts` (new)
- `src/db/index.ts`
- `src/index.ts`
- `src/cache.ts`
- `package.json` (added `version` export)
- `tests/announcements.test.ts` (new)

## 2026-03-16: Lint Warning Fixes

**Commit**: (part of PR #25)

**Changes**:

- Split `announceNewVersion` into smaller functions (fixed max-lines-per-function)
- Replaced `await` in loop with `Promise.allSettled` (fixed no-await-in-loop)
- Condensed error logging to reduce `cache.ts` from 310 to 295 lines (fixed max-lines)

**Files Changed**:

- `src/announcements.ts`
- `src/cache.ts`

## Architecture Updates

### New Modules

- `src/cache.ts` - In-memory user session cache with TTL and background sync
- `src/cache-helpers.ts` - JSON parsing helpers for cached data
- `src/announcements.ts` - Version announcement system
- `src/changelog-reader.ts` - CHANGELOG.md parsing
- `src/commands/context.ts` - Admin context export command
- `src/kaneo/schemas/` - 70+ Zod schema files for API validation
- `src/kaneo/task-update-helpers.ts` - Task update helper functions
- `src/kaneo/task-status.ts` - Task status/column management helpers

### Updated Modules

- `src/bot.ts` - Fixed conversation history persistence
- `src/cache.ts` - Added `clearCachedFacts` function
- `src/memory.ts` - Fixed `clearFacts` to clear in-memory cache
- All `src/kaneo/*-resource.ts` - Updated to use new Zod schemas

### New Commands

| Command    | Description                                                  | Access     |
| ---------- | ------------------------------------------------------------ | ---------- |
| `/context` | Export conversation history, summary, and facts as text file | Admin only |

### New Database Migration

**006_version_announcements.ts**:

```sql
CREATE TABLE IF NOT EXISTS version_announcements (
  version TEXT PRIMARY KEY,
  announced_at TEXT NOT NULL
)
```

## Testing Updates

### New Test Files

- `tests/announcements.test.ts` - 232 lines, covers announcement logic

### Test Infrastructure Issue

**Known Issue**: E2E tests are affected by mock leakage from unit tests. When `mock.module()` is called in unit tests, it persists across to E2E tests, causing failures. This is tracked in `docs/mock-leakage-analysis.md`.

**Current Status**:

- Unit tests: 537 passing
- E2E tests: 54 failing (due to mock leakage, not actual bugs)

## Documentation Updates

### Updated Files

- `CLAUDE.md` - Added announcement and context command documentation
- `docs/ROADMAP.md` - Marked conversation history fix as complete
- `docs/RECENT_CHANGES.md` - This file (new)

### New Documentation

- `docs/mock-leakage-analysis.md` - Analysis of test isolation issue
- `docs/E2E_TEST_FAILURE_REPORT.md` - E2E test failure analysis

## Migration Guide

No manual migration steps required. The database migration runs automatically on startup.

## Verification

To verify the changes:

```bash
# Run linter
bun run lint

# Run unit tests
bun test

# Check version (should show current version)
bun run src/index.ts --version
```

---

_Last updated: 2026-03-17_
