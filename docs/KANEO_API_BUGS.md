# Kaneo API Bugs Discovered During E2E Testing

This document tracks bugs and issues found in the Kaneo API during end-to-end testing of papai.

## Bug 1: PUT /task/:id Does Not Update Task Fields

**Status:** ⚠️ **Workaround Implemented**

**Description:**
The `PUT /api/task/:id` endpoint returns HTTP 200 and a task object, but the fields are not actually updated in the database.

**Expected Behavior:**
When sending a PUT request with updated fields, the task should be updated and the response should reflect the new values.

**Actual Behavior:**
The endpoint returns 200 with the original, unchanged task data.

**Example:**

```bash
# Request
PUT /api/task/jw5qqnlp82bwgicsqm2pv85r
Body: {"title":"Updated Title","priority":"high",...}

# Response
200 OK
{"title":"Original Title","priority":"low",...}  # Unchanged!
```

**Workaround:**
Use single-field endpoints instead:

- `PUT /api/task/title/:id` - for updating title
- `PUT /api/task/priority/:id` - for updating priority
- `PUT /api/task/status/:id` - for updating status
- `PUT /api/task/description/:id` - for updating description
- `PUT /api/task/due-date/:id` - for updating due date

**Fixed In:** `src/kaneo/task-resource.ts` - Modified `performUpdate()` to use single-field endpoints instead of the full update endpoint.

---

## Bug 2: Priority Update Endpoint Returns 200 But Doesn't Update

**Status:** ⚠️ **Known Issue**

**Description:**
The `PUT /api/task/priority/:id` endpoint accepts the request and returns 200, but the priority field is not updated.

**Expected Behavior:**
Priority should change from current value to the new value.

**Actual Behavior:**
Priority remains unchanged (returns "no-priority" regardless of input).

**Example:**

```bash
# Request
PUT /api/task/priority/gkyps1vrjfd6s9vngynpbz88
Body: {"priority":"high"}

# Response
200 OK
{"priority":"no-priority"}  # Unchanged!
```

**Note:** Priority WORKS on task creation (POST /api/task) but NOT on update.

**Test Impact:**
Test "updates a task" in `tests/e2e/task-lifecycle.test.ts` skips priority assertions with comment referencing this bug.

---

## Bug 3: listTasks Returns Empty Array

**Status:** ⚠️ **Known Issue**

**Description:**
The `GET /api/task/tasks/:projectId` endpoint returns a response with empty columns and plannedTasks arrays, even when tasks exist in the project.

**Expected Behavior:**
Should return tasks organized by columns.

**Actual Behavior:**
Returns empty arrays even after creating tasks successfully.

**Example:**

```bash
# Create two tasks in project
curl -X POST /api/task -d '{"title":"Task 1","projectId":"..."}'
curl -X POST /api/task -d '{"title":"Task 2","projectId":"..."}'

# List tasks
curl /api/task/tasks/:projectId

# Response
{
  "columns": [...],  // 4 columns
  "plannedTasks": [],  // Empty!
  "archivedTasks": []  // Empty!
}
```

**Note:** Tasks ARE created successfully (verified via GET /api/task/:id), but they're not returned in the list endpoint.

**Test Impact:**
Test "lists tasks in a project" in `tests/e2e/task-lifecycle.test.ts` is skipped with comment referencing this bug.

---

## Bug 4: Full Update Endpoint Fails on Null dueDate

**Status:** ✅ **Fixed via Workaround**

**Description:**
When using `PUT /api/task/:id` with a body that includes `dueDate: null`, the API returns a 400 validation error.

**Error Message:**

```json
{
  "error": [
    {
      "message": "Invalid type: Expected string but received null",
      "path": ["dueDate"]
    }
  ]
}
```

**Workaround:**
By using single-field endpoints (Bug #1 workaround), this issue is avoided since we only send dueDate when it's explicitly provided.

**Fixed In:** `src/kaneo/task-resource.ts` - `performUpdate()` now uses single-field endpoints, avoiding the full update endpoint entirely.

---

## Summary

| Bug                      | Endpoint                 | Status        | Impact                                |
| ------------------------ | ------------------------ | ------------- | ------------------------------------- |
| Full update doesn't work | `PUT /task/:id`          | ✅ Workaround | Fixed by using single-field endpoints |
| Priority update fails    | `PUT /task/priority/:id` | ⚠️ Known      | Test skipped                          |
| listTasks empty          | `GET /task/tasks/:id`    | ⚠️ Known      | Test skipped                          |
| Null dueDate validation  | `PUT /task/:id`          | ✅ Workaround | Fixed by using single-field endpoints |

---

## GitHub Issues

These bugs should be reported to the Kaneo project:

- **Kaneo Repository:** https://github.com/usekaneo/kaneo
- **Recommended Issue Title:** "API: PUT /task/:id endpoint doesn't persist updates"
- **Recommended Labels:** `bug`, `api`, `high-priority`

**Suggested Issue Content:**

```markdown
## Summary

The PUT /api/task/:id endpoint returns HTTP 200 but does not actually update task fields.

## Steps to Reproduce

1. Create a task via POST /api/task
2. Send PUT /api/task/:id with {"title":"New Title"}
3. Response returns 200 with original title unchanged

## Expected Behavior

Task fields should be updated and response should reflect changes.

## Actual Behavior

Response contains original, unchanged values.

## Additional Notes

- Single-field endpoints (e.g., /task/title/:id) work correctly
- This affects all fields: title, priority, status, description, dueDate
```
