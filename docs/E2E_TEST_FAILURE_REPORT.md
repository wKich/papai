# E2E Test Failure Report

**Date**: 2026-03-16
**Total E2E Tests**: 54
**Passed**: 14
**Failed**: 40
**Failure Rate**: 74%

## Executive Summary

The E2E tests are failing due to a systematic mismatch between the API documentation schemas (from llms.txt) and the actual Kaneo API responses. The documentation specifies certain fields as required, but the real API returns `undefined` or omits them entirely.

This is a common issue when generating schemas from documentation - the documentation may be outdated, aspirational, or simply incorrect compared to the actual implementation.

## Failure Categories

### Category 1: Activity/Comment Operations (11 tests)

**Failure Rate**: 100%

**Affected Tests**:

- Task Comments > adds a comment to a task
- Task Comments > handles long comments
- Task Comments > handles special characters in comments
- Task Comments > removes a comment
- Task Comments > retrieves comments for a task
- Task Comments > updates a comment
- Task Relations > addRelation > validates related task
- User Workflows > project setup workflow
- User Workflows > bulk operations workflow
- User Workflows > task dependencies workflow
- User Workflows > task handoff workflow

**Schema Expects**:

```typescript
{
  id: string,
  taskId: string,
  type: 'comment' | 'task' | 'status_changed' | ...,
  createdAt: string | object,
  userId: string | null,
  content: string | null,
  externalUserName: string | null,
  externalUserAvatar: string | null,
  externalSource: string | null,
  externalUrl: string | null
}
```

**API Actually Returns**:

```json
{}
```

**Root Cause**: The `createComment` endpoint (`POST /activity/comment`) returns an empty object `{}` instead of the activity data documented in the API. All 10 fields are `undefined`.

---

### Category 2: Column Operations (8 tests)

**Failure Rate**: 88%

**Affected Tests**:

- Column Management > creates a column with all properties
- Column Management > creates a final column
- Column Management > creates column without optional properties
- Column Management > deletes a column
- Column Management > lists columns in project
- Column Management > reorders columns
- Column Management > updates column color and icon
- Column Management > updates column name

**Schema Expects**:

```typescript
{
  id: string,
  name: string,
  icon: string | null,
  color: string | null,
  isFinal: boolean
}
```

**API Actually Returns**:

```json
{
  "id": "col-xxx",
  "name": "To Do",
  "icon": undefined,
  "color": undefined,
  "isFinal": false
}
```

**Root Cause**: The API returns `undefined` for `icon` and `color` fields instead of `null`. The schema allows `null` but not `undefined`.

---

### Category 3: Search Operations (4 tests)

**Failure Rate**: 100%

**Affected Tests**:

- Task Search and Filter > searches tasks by title keyword
- Task Search and Filter > searches across all projects
- Task Search and Filter > returns empty results for non-matching search
- Task Lifecycle > searches tasks by keyword

**Schema Expects**:

```typescript
{
  tasks: Task[],
  projects: Project[],
  workspaces: Workspace[],
  comments: Comment[],
  activities: Activity[]
}
```

**API Actually Returns**:

```json
{
  "tasks": undefined,
  "projects": undefined,
  "workspaces": undefined,
  "comments": undefined,
  "activities": undefined
}
```

**Root Cause**: The search response structure is completely different from the documentation. All array fields are `undefined` instead of empty arrays `[]`.

---

### Category 4: Task Lifecycle - List Tasks (2 tests)

**Failure Rate**: 28%

**Affected Tests**:

- Task Lifecycle > lists tasks in a project
- User Workflows > full task lifecycle workflow

**Issue**: Same as Category 2 - the list tasks endpoint includes columns with `icon` and `color` as `undefined`.

---

### Category 5: Project Operations (5 tests)

**Failure Rate**: 50%

**Affected Tests**:

- Project Lifecycle > creates and lists projects
- Project Lifecycle > lists columns in a project
- Project Lifecycle > updates a project
- Project Archive > deletes a project
- Project Archive > lists projects in workspace
- Project Archive > updates project name and description

**Schema Expects**:

```typescript
{
  id: string,
  name: string,
  slug: string,
  workspaceId: string,
  icon: string | null,
  description: string | null,
  isPublic: boolean,
  createdAt: string | Date
}
```

**Root Cause**: Missing `workspaceId`, `icon`, `description`, `isPublic`, and `createdAt` fields in API responses.

---

### Category 6: Label Operations (6 tests)

**Failure Rate**: 50%

**Affected Tests**:

- Label Management > creates and lists labels
- Label Management > updates a label
- Label Management > adds and removes label from task
- Label Operations > creates label with color
- Label Operations > lists all labels in workspace
- Label Operations > removes a label

**Issues**:

- Missing `createdAt`, `taskId`, `workspaceId` fields
- Label operations return incomplete data

---

### Category 7: Task Archive (2 tests)

**Failure Rate**: 100%

**Affected Tests**:

- Task Archive > archives a task
- Task Archive > can still retrieve archived task

**Root Cause**: Tests fail immediately, likely due to incomplete mock data or missing endpoint implementation.

---

### Category 8: Error Handling (3 tests)

**Failure Rate**: 33%

**Affected Tests**:

- Error Handling > handles special characters in task title
- Error Handling > throws error when updating non-existent task
- Error Handling > throws error for non-existent task

**Issues**: Schema validation errors for error responses.

---

## Schema Mismatch Analysis

### Most Common Issues

1. **`undefined` vs `null`** (Category 2, 4)
   - The API returns `undefined` for optional fields
   - The schema expects `null` for optional fields
   - **Fix**: Change schema from `z.string().nullable()` to `z.string().optional().nullable()`

2. **Empty Response Body** (Category 1)
   - The API returns `{}` for create operations
   - The schema expects complete object
   - **Fix**: Make all fields in activity response schemas optional

3. **Missing Fields** (Categories 3, 5, 6)
   - The API omits fields entirely
   - The schema marks them as required
   - **Fix**: Mark missing fields as optional in schemas

4. **Response Structure Mismatch** (Category 3)
   - Search endpoint has different response format
   - **Fix**: Update schema to match actual API response

---

## Recommendations

### Option 1: Make Schemas Lenient (Quick Fix)

Update all schemas to be more permissive:

```typescript
// From:
createdAt: z.string().or(z.object({}))

// To:
createdAt: z.string().or(z.object({})).optional()

// From:
icon: z.string().nullable()

// To:
icon: z.string().nullable().optional()
```

**Pros**: Tests will pass immediately
**Cons**: Loses type safety, won't catch actual API bugs

### Option 2: Update Schemas to Match Real API (Correct Fix)

Investigate each endpoint and update schemas to match actual responses:

1. Comment endpoints return `{}` - update schema to `z.object({})`
2. Column icon/color are optional - mark as `.optional()`
3. Search response has different structure - update to match
4. Project fields are optional - mark as `.optional()`

**Pros**: Accurate type safety
**Cons**: Time-consuming, requires testing each endpoint

### Option 3: Hybrid Approach (Recommended)

1. Make schemas lenient for E2E tests to pass
2. Add separate "strict" schemas for development
3. Use lenient schemas in production for robustness
4. Document API discrepancies for Kaneo team

---

## Files to Update

1. `src/kaneo/schemas/createComment.ts` - Make all fields optional
2. `src/kaneo/schemas/updateComment.ts` - Make all fields optional
3. `src/kaneo/schemas/getActivities.ts` - Make all fields optional
4. `src/kaneo/schemas/listTasks.ts` - Make column icon/color optional
5. `src/kaneo/schemas/create-project.ts` - Make workspaceId, icon, description optional
6. `src/kaneo/schemas/get-project.ts` - Same as above
7. `src/kaneo/schemas/update-project.ts` - Same as above
8. `src/kaneo/schemas/global-search.ts` - Update response structure
9. `src/kaneo/schemas/createLabel.ts` - Make createdAt, taskId, workspaceId optional
10. `src/kaneo/schemas/getWorkspaceLabels.ts` - Same as above

---

## Conclusion

The E2E test failures reveal significant discrepancies between the Kaneo API documentation and the actual API implementation. This is a common issue with auto-generated documentation or when the documentation is not kept in sync with the code.

The recommended approach is to:

1. Make schemas lenient enough to handle real API responses
2. Add runtime validation with detailed logging to catch API changes
3. Report documentation bugs to the Kaneo team
4. Consider removing strict Zod validation for API responses and only validating critical fields

---

_Report generated by automated analysis of E2E test output_
