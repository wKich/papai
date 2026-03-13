# Kaneo Column API Endpoint Research

## Task

Research the correct Kaneo Column API endpoint patterns to fix E2E test failures (409 Conflict errors).

## Files Examined

### Resource Files Compared

1. `src/kaneo/column-resource.ts` - Current column implementation
2. `src/kaneo/project-resource.ts` - Working project implementation
3. `src/kaneo/task-resource.ts` - Working task implementation
4. `src/kaneo/label-resource.ts` - Working label implementation
5. `src/kaneo/comment-resource.ts` - Comment implementation

### Kaneo API Source Analysis

Examined `/app/apps/api/dist/index.js` in the running Kaneo container to extract actual API routes.

## Current Column Endpoints (column-resource.ts)

| Operation | Current Endpoint                   | Line |
| --------- | ---------------------------------- | ---- |
| list      | `GET /column/${projectId}`         | 19   |
| create    | `POST /column/${projectId}`        | 42   |
| update    | `PUT /column/${columnId}`          | 84   |
| remove    | `DELETE /column/${columnId}`       | 100  |
| reorder   | `PUT /column/reorder/${projectId}` | 116  |

## Kaneo API Actual Routes

From Kaneo API source code analysis:

```javascript
// src/column/index.ts
var column = new Hono2()
  .get("/:projectId", ...)          // List columns
  .post("/:projectId", ...)         // Create column
  .put("/reorder/:projectId", ...)  // Reorder columns
  .put("/:id", ...)                 // Update column
  .delete("/:id", ...)              // Delete column
```

**Result: Current endpoints MATCH the Kaneo API routes exactly!**

## Comparison with Other Resources

### Project Endpoints (working)

- `POST /project` - Create
- `GET /project?workspaceId=` - List
- `PUT /project/${id}` - Update
- `DELETE /project/${id}` - Archive

### Task Endpoints (working)

- `POST /task/${projectId}` - Create
- `GET /task/tasks/${projectId}` - List
- `GET /task/${taskId}` - Get single
- `PUT /task/${taskId}` - Update (via single-field endpoints)
- `DELETE /task/${taskId}` - Delete

### Label Endpoints (working)

- `POST /label` - Create
- `GET /label/workspace/${workspaceId}` - List
- `PUT /label/${labelId}` - Update
- `DELETE /label/${labelId}` - Remove

### Comment Endpoints (working)

- `POST /activity/comment` - Add
- `GET /activity/${taskId}` - List
- `PUT /activity/comment` - Update
- `DELETE /activity/comment` - Remove

## Root Cause of 409 Errors

The E2E tests are failing with **409 Conflict** because:

1. **Projects have default columns created automatically:**
   - "To Do" (slug: "to-do")
   - "In Progress" (slug: "in-progress")
   - "Done" (slug: "done")

2. **The Kaneo API enforces unique slugs per project:**

   ```javascript
   // From create-column.ts controller
   const existing = await database_default
     .select({ id: columnTable.id })
     .from(columnTable)
     .where(sql`${columnTable.projectId} = ${projectId} AND ${columnTable.slug} = ${slug}`)
   if (existing.length > 0) {
     throw new HTTPException3(409, {
       message: `Column with slug "${slug}" already exists in this project`,
     })
   }
   ```

3. **Test names conflict with default columns:**
   - Test tries to create "Done" column → conflicts with default "Done" column
   - Test tries to create "In Review" → slug "in-review" (OK, not duplicate)
   - Test tries to create "Backlog" → slug "backlog" (OK, not duplicate)

## Recommended Endpoint Corrections

**The endpoints are CORRECT!** No changes needed to the endpoint patterns.

The issue is in the E2E tests themselves - they need to use unique column names that don't conflict with the default columns created when a project is instantiated.

### Default Columns Created Per Project

When `createProject` is called, Kaneo automatically creates these columns:

1. To Do (slug: to-do)
2. In Progress (slug: in-progress)
3. Done (slug: done, isFinal: true)

## Conclusion

- **column-resource.ts endpoints are correct** and match Kaneo API
- **E2E tests need to be updated** to avoid name conflicts with default columns
- The 409 errors are expected behavior from the Kaneo API
- Tests should use unique names like "Test Column A", "Custom Status", etc.

## References

- E2E test file: `tests/e2e/column-management.test.ts`
- Kaneo API source: Container `/app/apps/api/dist/index.js`
- Default columns defined in Kaneo project creation controller
