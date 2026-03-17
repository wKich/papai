# Remaining Type Errors and Unit Test Failures Report

**Date**: 2026-03-16
**Status**: Post E2E Fix Verification

## Summary

After fixing all 54 E2E tests, we have remaining type errors and unit test failures that need to be addressed. This report documents the issues and provides recommendations for fixing them using the `api-compat.ts` pattern.

## Current Status

- **TypeScript Errors**: 2 compilation errors
- **Lint**: 0 errors, 0 warnings ✅
- **Lint Disable Comments**: 0 ✅
- **Unit Tests**: 367 pass / 6 fail
- **E2E Tests**: 54 pass / 0 fail ✅

## Type Errors (2 files)

### 1. src/kaneo/list-projects.ts:26

**Error**: `Type '{ id: string; slug: string; name: string; workspaceId?: string | undefined; ... }[]' is not assignable to type '{ id: string; workspaceId: string; ... }[]'`

**Root Cause**:

- The `ProjectSchema` in `list-projects.ts` has `workspaceId` as required
- The API doesn't return `workspaceId` in list response
- TypeScript correctly identifies this mismatch

**Schema** (list-projects.ts:17-26):

```typescript
export const ProjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(), // Required - but API omits this
  slug: z.string(),
  icon: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.unknown(),
  isPublic: z.boolean().nullable(),
})
```

**API Actually Returns**:

```json
{
  "id": "proj-xxx",
  "slug": "test-project",
  "name": "Test Project",
  "icon": null,
  "description": null,
  "createdAt": "2026-03-16T...",
  "isPublic": false
  // workspaceId is MISSING
}
```

**Files Affected**:

- `src/kaneo/list-projects.ts` - Uses `ProjectSchema` for return type
- `src/kaneo/create-project.ts` - Same schema issue

### 2. tests/e2e/kaneo-test-client.ts:43

**Error**: `Type '{ id: string; name: string; workspaceId?: string | undefined; slug?: string | undefined; ... }' is not assignable to type '{ id: string; name: string; slug: string }'`

**Root Cause**:

- `createTestProject()` return type expects `{ id: string; name: string; slug: string }`
- The actual returned project has `slug` as optional (because API sometimes omits it)
- Function signature at line 30: `Promise<{ id: string; name: string; slug: string }>`

**Function** (lines 30-43):

```typescript
async createTestProject(name?: string): Promise<{ id: string; name: string; slug: string }> {
  const project = await createProject({...})
  return project  // Type mismatch here
}
```

## Unit Test Failures (6 tests)

### Pattern: "isFinal: expected boolean, received undefined"

**Affected Tests**: Unknown from output, but error shows column validation failing

**Root Cause**:

- `ColumnSchema.isFinal` is required boolean
- API returns columns without `isFinal` field (undefined)
- Schema validation fails

**Schema** (listTasks.ts:9):

```typescript
const ColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isFinal: z.boolean(), // Required - but API omits this
})
```

**Note**: The api-compat.ts already has `ColumnCompatSchema` that fixes icon/color but doesn't address `isFinal`.

## Recommended Fixes

### Option 1: Extend api-compat.ts (Recommended)

Add lenient schemas to `src/kaneo/schemas/api-compat.ts`:

```typescript
/**
 * GET /project returns projects without workspaceId field.
 *
 * Root cause: API omits workspaceId from list response to reduce payload size
 * Upstream bug: https://github.com/usekaneo/kaneo/issues/XXX
 */
export const ProjectListItemCompatSchema = ProjectSchema.extend({
  workspaceId: z.string().optional(),
  slug: z.string().optional(),
  icon: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  createdAt: z.unknown().optional(),
  isPublic: z.boolean().nullable().optional(),
})
export type ProjectListItemCompat = z.infer<typeof ProjectListItemCompatSchema>

/**
 * GET /column returns columns without isFinal field.
 *
 * Root cause: isFinal is not populated in some API responses
 * Upstream bug: https://github.com/usekaneo/kaneo/issues/XXX
 */
export const ColumnFullCompatSchema = ColumnSchema.extend({
  isFinal: z.boolean().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
})
export type ColumnFullCompat = z.infer<typeof ColumnFullCompatSchema>
```

Then update these files to use compat schemas:

1. `src/kaneo/list-projects.ts` - Use `ProjectListItemCompatSchema`
2. `src/kaneo/create-project.ts` - Use `ProjectListItemCompatSchema`
3. `src/kaneo/task-resource.ts` - Use `ColumnFullCompatSchema` for list operations
4. `tests/e2e/kaneo-test-client.ts` - Update return type to match compat schema

### Option 2: Update Original Schemas (Quick Fix)

Modify the original schema files directly:

1. `src/kaneo/schemas/list-projects.ts` - Make fields optional
2. `src/kaneo/schemas/listTasks.ts` - Make isFinal optional in ColumnSchema

**Pros**: Simple, no need for compat layer
**Cons**: Loses documentation accuracy, harder to track what API "should" return

### Option 3: Type Assertions (Minimal Change)

Add type assertions in the affected files:

```typescript
// In list-projects.ts:26
return projects as KaneoProject[]

// In kaneo-test-client.ts:43
return project as { id: string; name: string; slug: string }
```

**Pros**: Minimal changes
**Cons**: Bypasses type safety, technical debt

## Decision Matrix

| Approach                          | Type Safety | Documentation Accuracy | Maintainability | Recommended |
| --------------------------------- | ----------- | ---------------------- | --------------- | ----------- |
| Option 1: Extend api-compat.ts    | ✅ High     | ✅ Preserved           | ✅ Good         | ✅ **Yes**  |
| Option 2: Update Original Schemas | ✅ High     | ❌ Lost                | ⚠️ Medium       | No          |
| Option 3: Type Assertions         | ❌ Low      | ✅ Preserved           | ❌ Poor         | No          |

## Next Steps

1. **Document upstream bugs**: Create GitHub issues in Kaneo repo for each API deviation
2. **Implement Option 1**: Add compat schemas to api-compat.ts
3. **Update source files**: Replace strict schemas with compat versions where needed
4. **Update tests**: Fix kaneo-test-client.ts return type
5. **Verify**: Run full test suite to ensure everything passes

## Impact

- **Breaking Changes**: None (using compat schemas maintains backward compatibility)
- **Test Coverage**: All E2E tests already passing
- **Type Safety**: Preserved through compat layer
- **Documentation**: Accurate schemas in original files, lenient in compat

---

_Report generated for schema migration verification_
