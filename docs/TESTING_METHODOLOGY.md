# Kaneo Tools Testing & Verification Methodology

## Executive Summary

This document provides a comprehensive methodology for testing and verifying that all papai tools correctly implement the Kaneo API specification.

**Based on:** API_COMPLIANCE_ANALYSIS.md  
**Total Tools:** 24  
**Overall Compliance:** 75%

---

## 1. Testing Methodology Overview

### 1.1 Testing Pyramid

```
┌─────────────────────────────────────┐
│  Integration Tests (Real API calls) │  10% - Critical paths only
├─────────────────────────────────────┤
│  Contract Tests (Schema validation)  │  30% - API compliance
├─────────────────────────────────────┤
│  Unit Tests (Mocked responses)     │  60% - Logic validation
└─────────────────────────────────────┘
```

### 1.2 Test Categories

1. **Happy Path Tests** - Normal operation with valid inputs
2. **Edge Case Tests** - Boundary conditions (empty strings, max lengths)
3. **Error Handling Tests** - API error responses (400, 401, 404, etc.)
4. **Schema Validation Tests** - Response structure compliance
5. **Parameter Validation Tests** - Required vs optional parameters

---

## 2. Test Case Design Patterns

### 2.1 Pattern A: CRUD Operations

For each resource (Task, Project, Label, Comment), test:

```
1. CREATE - Successfully create with required fields
2. CREATE - Fail without required fields
3. READ   - Get existing resource
4. READ   - Fail for non-existent resource (404)
5. UPDATE - Update single field
6. UPDATE - Update multiple fields
7. UPDATE - Fail for non-existent resource
8. DELETE - Successfully remove
9. DELETE - Fail for non-existent resource
10. LIST  - Get all resources
11. LIST  - Handle empty results
```

### 2.2 Pattern B: Resource Relationships

For dependent resources (Task Labels, Comments):

```
1. ADD    - Add relation to parent
2. ADD    - Fail when parent doesn't exist
3. LIST   - Get all related items
4. REMOVE - Remove specific relation
5. REMOVE - Fail when relation doesn't exist
```

### 2.3 Pattern C: Search & Filtering

For search operations:

```
1. SEARCH - Find matching items
2. SEARCH - Return empty for no matches
3. SEARCH - Filter by optional parameters
4. SEARCH - Handle special characters in query
5. SEARCH - Respect limit parameter
```

---

## 3. Verification Checklist per Tool

### 3.1 Tool: create_task

**API Endpoint:** `POST /task/{projectId}`

**Test Cases:**

| #   | Test                          | Expected                                                 | Priority |
| --- | ----------------------------- | -------------------------------------------------------- | -------- |
| 1   | Create with title only        | Success, defaults: priority='no-priority', status='todo' | HIGH     |
| 2   | Create with all fields        | Success, returns complete task                           | HIGH     |
| 3   | Create without title          | Validation error (400)                                   | HIGH     |
| 4   | Create with invalid projectId | 404 error                                                | HIGH     |
| 5   | Verify response schema        | Contains: id, title, number, status, priority            | HIGH     |
| 6   | Create with empty description | Success, description=''                                  | MEDIUM   |
| 7   | Create with dueDate           | Success, proper date format                              | MEDIUM   |
| 8   | Create with invalid priority  | Validation error                                         | MEDIUM   |

**Compliance Checks:**

- [ ] HTTP method is POST
- [ ] projectId is passed as path parameter
- [ ] Required body fields: title, description, priority, status
- [ ] Optional body fields: dueDate, userId
- [ ] Response matches Task schema

### 3.2 Tool: update_task

**API Endpoint:** `PUT /task/{id}` (full update) OR individual endpoints

**Test Cases:**

| #   | Test                        | Expected                        | Priority |
| --- | --------------------------- | ------------------------------- | -------- |
| 1   | Update single field (title) | Success, other fields preserved | HIGH     |
| 2   | Update multiple fields      | Success, all changes applied    | HIGH     |
| 3   | Update non-existent task    | 404 error                       | HIGH     |
| 4   | Update status only          | Uses PUT /task/status/{id}      | HIGH     |
| 5   | Update priority only        | Uses PUT /task/priority/{id}    | HIGH     |
| 6   | Update with invalid taskId  | 404 error                       | HIGH     |
| 7   | Verify response schema      | Complete task object returned   | HIGH     |
| 8   | Update dueDate              | Proper ISO date format          | MEDIUM   |

**Compliance Checks:**

- [ ] Smart routing: single-field updates use specific endpoints
- [ ] Full update preserves unspecified fields
- [ ] Response matches Task schema
- [ ] Error classification correct (404 → task-not-found)

### 3.3 Tool: list_tasks

**API Endpoint:** `GET /task/tasks/{projectId}`

**Test Cases:**

| #   | Test                          | Expected                                  | Priority |
| --- | ----------------------------- | ----------------------------------------- | -------- |
| 1   | List tasks for valid project  | Returns flattened task array              | HIGH     |
| 2   | List for empty project        | Returns empty array                       | HIGH     |
| 3   | List for non-existent project | Empty array (no error)                    | MEDIUM   |
| 4   | Verify task structure         | Each task has id, title, status, priority | HIGH     |
| 5   | Tasks ordered by column       | Proper grouping maintained                | LOW      |

**Compliance Checks:**

- [ ] HTTP method is GET
- [ ] projectId passed as path parameter
- [ ] Returns array of tasks (flattened from column structure)
- [ ] No query parameters required

### 3.4 Tool: get_task

**API Endpoint:** `GET /task/{id}`

**Test Cases:**

| #   | Test                    | Expected                     | Priority |
| --- | ----------------------- | ---------------------------- | -------- |
| 1   | Get existing task       | Complete task with relations | HIGH     |
| 2   | Get non-existent task   | 404 error                    | HIGH     |
| 3   | Verify relations parsed | YAML frontmatter extracted   | HIGH     |
| 4   | Task without relations  | Empty relations object       | MEDIUM   |
| 5   | Invalid taskId format   | 404 error                    | MEDIUM   |

**Compliance Checks:**

- [ ] HTTP method is GET
- [ ] taskId passed as path parameter
- [ ] Response includes full Task schema
- [ ] Description parsed for frontmatter relations

### 3.5 Tool: archive_task

**API Endpoint:** Custom (label-based)

**Test Cases:**

| #   | Test                            | Expected                    | Priority |
| --- | ------------------------------- | --------------------------- | -------- |
| 1   | Archive existing task           | Adds 'archived' label       | HIGH     |
| 2   | Archive non-existent task       | 404 error                   | HIGH     |
| 3   | Create archive label if missing | Label created automatically | HIGH     |
| 4   | Archive already archived task   | Idempotent                  | MEDIUM   |
| 5   | Verify label applied            | Label exists on task        | MEDIUM   |

**Compliance Checks:**

- [ ] Uses GET /label/workspace/{workspaceId} to find archive label
- [ ] Creates label via POST /label if not exists
- [ ] Applies label via GET/POST pattern
- [ ] Returns taskId and archivedAt timestamp

### 3.6 Tool: list_projects

**API Endpoint:** `GET /project`

**Test Cases:**

| #   | Test                      | Expected                | Priority |
| --- | ------------------------- | ----------------------- | -------- |
| 1   | List projects             | Array of projects       | HIGH     |
| 2   | Empty workspace           | Empty array             | HIGH     |
| 3   | Verify workspaceId passed | Query param included    | HIGH     |
| 4   | Response structure        | id, name, slug for each | HIGH     |
| 5   | Verify schema             | Minimal or full schema  | MEDIUM   |

**Compliance Checks:**

- [ ] HTTP method is GET
- [ ] workspaceId passed as query parameter (REQUIRED)
- [ ] Returns array of projects
- [ ] Response schema matches Project schema

### 3.7 Tool: create_project

**API Endpoint:** `POST /project`

**Test Cases:**

| #   | Test                    | Expected                        | Priority |
| --- | ----------------------- | ------------------------------- | -------- |
| 1   | Create with name only   | Success, auto-generates slug    | HIGH     |
| 2   | Create with description | Two API calls (create + update) | HIGH     |
| 3   | Create without name     | Validation error                | HIGH     |
| 4   | Verify slug generation  | Lowercase, hyphenated           | MEDIUM   |
| 5   | Duplicate project name  | Allowed (different slugs)       | LOW      |
| 6   | Response includes id    | Project object returned         | HIGH     |

**Compliance Checks:**

- [ ] HTTP method is POST
- [ ] Required body: name, workspaceId, icon, slug
- [ ] Description updated via separate PUT call
- [ ] Slug auto-generated from name
- [ ] Response matches Project schema

### 3.8 Tool: update_project

**API Endpoint:** `PUT /project/{id}`

**Test Cases:**

| #   | Test                             | Expected                        | Priority |
| --- | -------------------------------- | ------------------------------- | -------- |
| 1   | Update name only                 | Success, other fields preserved | HIGH     |
| 2   | Update description only          | Success, name preserved         | HIGH     |
| 3   | Update both name and description | Success                         | HIGH     |
| 4   | Update non-existent project      | 404 error                       | HIGH     |
| 5   | Verify workspaceId passed        | Query param in GET call         | HIGH     |
| 6   | Update with empty description    | description=''                  | MEDIUM   |

**Compliance Checks:**

- [ ] HTTP method is PUT
- [ ] projectId passed as path parameter
- [ ] GET call includes workspaceId query parameter
- [ ] Full body sent (name, icon, slug, description, isPublic)
- [ ] Response matches Project schema

### 3.9 Tool: archive_project

**API Endpoint:** `DELETE /project/{id}`

**Test Cases:**

| #   | Test                         | Expected                       | Priority |
| --- | ---------------------------- | ------------------------------ | -------- |
| 1   | Archive existing project     | Success, returns {id, success} | HIGH     |
| 2   | Archive non-existent project | 404 error                      | HIGH     |
| 3   | Verify deletion              | Cannot retrieve after archive  | HIGH     |
| 4   | Archive with tasks           | Tasks also deleted             | MEDIUM   |

**Compliance Checks:**

- [ ] HTTP method is DELETE
- [ ] projectId passed as path parameter
- [ ] Returns success confirmation
- [ ] Error classification correct (404 → project-not-found)

### 3.10 Tool: list_labels

**API Endpoint:** `GET /label/workspace/{workspaceId}`

**Test Cases:**

| #   | Test                       | Expected                  | Priority |
| --- | -------------------------- | ------------------------- | -------- |
| 1   | List labels                | Array of workspace labels | HIGH     |
| 2   | Empty workspace            | Empty array               | HIGH     |
| 3   | Verify workspaceId in path | Path parameter correct    | HIGH     |
| 4   | Response structure         | id, name, color for each  | HIGH     |

**Compliance Checks:**

- [ ] HTTP method is GET
- [ ] workspaceId passed as path parameter
- [ ] Returns array of labels
- [ ] Response matches Label schema

### 3.11 Tool: create_label

**API Endpoint:** `POST /label`

**Test Cases:**

| #   | Test                       | Expected                   | Priority |
| --- | -------------------------- | -------------------------- | -------- |
| 1   | Create with name only      | Success, default color     | HIGH     |
| 2   | Create with name and color | Success                    | HIGH     |
| 3   | Create without name        | Validation error           | HIGH     |
| 4   | Create with invalid color  | Validation error           | MEDIUM   |
| 5   | Default color              | '#6b7280' if not specified | MEDIUM   |
| 6   | Response includes id       | Label object returned      | HIGH     |

**Compliance Checks:**

- [ ] HTTP method is POST
- [ ] Required body: name, color, workspaceId
- [ ] Color defaults to '#6b7280'
- [ ] Response matches Label schema

### 3.12 Tool: update_label

**API Endpoint:** `PUT /label/{id}`

**Test Cases:**

| #   | Test                      | Expected                 | Priority |
| --- | ------------------------- | ------------------------ | -------- |
| 1   | Update name only          | Success, color preserved | HIGH     |
| 2   | Update color only         | Success, name preserved  | HIGH     |
| 3   | Update both               | Success                  | HIGH     |
| 4   | Update non-existent label | 404 error                | HIGH     |
| 5   | Response structure        | Complete label object    | HIGH     |

**Compliance Checks:**

- [ ] HTTP method is PUT
- [ ] labelId passed as path parameter
- [ ] Required body: name, color
- [ ] Fetch existing to preserve unspecified fields
- [ ] Response matches Label schema

### 3.13 Tool: remove_label

**API Endpoint:** `DELETE /label/{id}`

**Test Cases:**

| #   | Test                      | Expected                     | Priority |
| --- | ------------------------- | ---------------------------- | -------- |
| 1   | Remove existing label     | Success                      | HIGH     |
| 2   | Remove non-existent label | 404 error                    | HIGH     |
| 3   | Verify removal            | Cannot retrieve after delete | HIGH     |

**Compliance Checks:**

- [ ] HTTP method is DELETE
- [ ] labelId passed as path parameter
- [ ] Returns success confirmation
- [ ] Error classification correct (404 → label-not-found)

### 3.14 Tool: add_task_label

**API Endpoint:** Custom (GET + POST pattern)

**Test Cases:**

| #   | Test                       | Expected                     | Priority |
| --- | -------------------------- | ---------------------------- | -------- |
| 1   | Add existing label to task | Success, copies label        | HIGH     |
| 2   | Add non-existent label     | 404 error                    | HIGH     |
| 3   | Add to non-existent task   | 404 error                    | HIGH     |
| 4   | Add duplicate label        | Idempotent or error          | MEDIUM   |
| 5   | Verify label on task       | Label appears in task labels | HIGH     |

**Compliance Checks:**

- [ ] GET /label/{labelId} to fetch label details
- [ ] POST /label with taskId to copy label
- [ ] workspaceId used to find/create labels
- [ ] Response confirms label added

### 3.15 Tool: remove_task_label

**API Endpoint:** `GET /label/task/{taskId}` + `DELETE /label/{id}`

**Test Cases:**

| #   | Test                          | Expected                      | Priority |
| --- | ----------------------------- | ----------------------------- | -------- |
| 1   | Remove label from task        | Success                       | HIGH     |
| 2   | Remove non-existent label     | 404 error                     | HIGH     |
| 3   | Remove from non-existent task | 404 error                     | HIGH     |
| 4   | Remove wrong label from task  | 404 (label not found on task) | MEDIUM   |

**Compliance Checks:**

- [ ] GET /label/task/{taskId} to list task labels
- [ ] Find matching label by ID
- [ ] DELETE /label/{matchingLabel.id}
- [ ] Error if label not found on task

### 3.16 Tool: add_task_relation

**API Endpoint:** Custom (frontmatter-based)

**Test Cases:**

| #   | Test                      | Expected                 | Priority |
| --- | ------------------------- | ------------------------ | -------- |
| 1   | Add blocks relation       | YAML frontmatter updated | HIGH     |
| 2   | Add blocked_by relation   | YAML frontmatter updated | HIGH     |
| 3   | Add related relation      | YAML frontmatter updated | HIGH     |
| 4   | Add duplicate relation    | Updated or ignored       | MEDIUM   |
| 5   | Invalid relation type     | Validation error         | MEDIUM   |
| 6   | Non-existent related task | Validation error         | HIGH     |

**Compliance Checks:**

- [ ] GET /task/{taskId} to fetch current description
- [ ] Parse existing frontmatter
- [ ] Add relation to frontmatter
- [ ] PUT /task/description/{taskId} with updated description
- [ ] Response confirms relation added

### 3.17 Tool: update_task_relation

**API Endpoint:** Custom (frontmatter-based)

**Test Cases:**

| #   | Test                         | Expected             | Priority |
| --- | ---------------------------- | -------------------- | -------- |
| 1   | Change relation type         | blocks → blocked_by  | HIGH     |
| 2   | Update non-existent relation | 404 error            | HIGH     |
| 3   | Same type update             | Idempotent           | MEDIUM   |
| 4   | Remove and re-add            | Equivalent to update | MEDIUM   |

**Compliance Checks:**

- [ ] Verify relation exists in frontmatter
- [ ] Remove old relation entry
- [ ] Add new relation entry with updated type
- [ ] PUT /task/description/{taskId}

### 3.18 Tool: remove_task_relation

**API Endpoint:** Custom (frontmatter-based)

**Test Cases:**

| #   | Test                          | Expected                | Priority |
| --- | ----------------------------- | ----------------------- | -------- |
| 1   | Remove existing relation      | Frontmatter updated     | HIGH     |
| 2   | Remove non-existent relation  | 404 error               | HIGH     |
| 3   | Remove from non-existent task | 404 error               | HIGH     |
| 4   | Remove last relation          | Empty relations section | MEDIUM   |

**Compliance Checks:**

- [ ] GET /task/{taskId} to fetch current
- [ ] Parse frontmatter and find relation
- [ ] Remove relation entry
- [ ] PUT /task/description/{taskId}
- [ ] Handle empty relations (clean up frontmatter)

### 3.19 Tool: add_comment

**API Endpoint:** `POST /activity/comment`

**Test Cases:**

| #   | Test                     | Expected                  | Priority |
| --- | ------------------------ | ------------------------- | -------- |
| 1   | Add comment to task      | Success, returns activity | HIGH     |
| 2   | Add empty comment        | Validation error          | HIGH     |
| 3   | Add to non-existent task | 404 error                 | HIGH     |
| 4   | Verify response          | id, comment, createdAt    | HIGH     |
| 5   | Long comment             | Success (no length limit) | MEDIUM   |

**Compliance Checks:**

- [ ] HTTP method is POST
- [ ] Required body: taskId, comment
- [ ] Response matches Activity schema
- [ ] type='comment' automatically set

### 3.20 Tool: get_comments

**API Endpoint:** `GET /activity/{taskId}`

**Test Cases:**

| #   | Test                  | Expected                | Priority |
| --- | --------------------- | ----------------------- | -------- |
| 1   | Get comments for task | Array of comments       | HIGH     |
| 2   | Task with no comments | Empty array             | HIGH     |
| 3   | Non-existent task     | Empty array             | MEDIUM   |
| 4   | Verify filtering      | type='comment' only     | HIGH     |
| 5   | Verify ordering       | By createdAt descending | MEDIUM   |

**Compliance Checks:**

- [ ] HTTP method is GET
- [ ] taskId passed as path parameter
- [ ] Filters activities by type='comment'
- [ ] Returns array of Activity objects

### 3.21 Tool: update_comment

**API Endpoint:** `PUT /activity/comment`

**Test Cases:**

| #   | Test                        | Expected                | Priority |
| --- | --------------------------- | ----------------------- | -------- |
| 1   | Update comment text         | Success                 | HIGH     |
| 2   | Update non-existent comment | 404 error               | HIGH     |
| 3   | Empty comment text          | Validation error        | HIGH     |
| 4   | Response structure          | Updated activity object | HIGH     |

**Compliance Checks:**

- [ ] HTTP method is PUT
- [ ] Required body: activityId, comment
- [ ] Response matches Activity schema
- [ ] Error classification correct (404 → comment-not-found)

### 3.22 Tool: remove_comment

**API Endpoint:** `DELETE /activity/comment`

**Test Cases:**

| #   | Test                        | Expected               | Priority |
| --- | --------------------------- | ---------------------- | -------- |
| 1   | Remove existing comment     | Success                | HIGH     |
| 2   | Remove non-existent comment | 404 error              | HIGH     |
| 3   | Verify removal              | Not in subsequent list | HIGH     |

**Compliance Checks:**

- [ ] HTTP method is DELETE
- [ ] Required body: activityId
- [ ] Returns success confirmation
- [ ] Error classification correct (404 → comment-not-found)

### 3.23 Tool: search_tasks

**API Endpoint:** `GET /search`

**Test Cases:**

| #   | Test                         | Expected                           | Priority |
| --- | ---------------------------- | ---------------------------------- | -------- |
| 1   | Search by keyword            | Matching tasks returned            | HIGH     |
| 2   | Search with no matches       | Empty results                      | HIGH     |
| 3   | Search with workspace filter | Results scoped to workspace        | HIGH     |
| 4   | Search with project filter   | Results scoped to project          | MEDIUM   |
| 5   | Empty query                  | Validation error                   | MEDIUM   |
| 6   | Special characters           | Properly escaped                   | MEDIUM   |
| 7   | Response structure           | results[], totalCount, searchQuery | HIGH     |

**Compliance Checks:**

- [ ] HTTP method is GET
- [ ] Required query: q, workspaceId
- [ ] Optional query: type, projectId, limit
- [ ] Response matches SearchResult schema

### 3.24 Tool: list_columns

**API Endpoint:** `GET /column/{projectId}`

**Test Cases:**

| #   | Test                     | Expected                       | Priority |
| --- | ------------------------ | ------------------------------ | -------- |
| 1   | List columns for project | Array of columns               | HIGH     |
| 2   | Empty project            | Empty array or default columns | HIGH     |
| 3   | Non-existent project     | 404 error                      | HIGH     |
| 4   | Response structure       | id, name, color, isFinal       | HIGH     |
| 5   | Verify ordering          | Position-ordered               | MEDIUM   |

**Compliance Checks:**

- [ ] HTTP method is GET
- [ ] projectId passed as path parameter
- [ ] Returns array of Column objects
- [ ] Response matches Column schema

---

## 4. API Compliance Validation Steps

### 4.1 Automated Schema Validation

Create a test that validates responses against official OpenAPI spec:

```typescript
// Pseudo-code for automated validation
describe('API Schema Compliance', () => {
  test('create_task response matches OpenAPI spec', async () => {
    const response = await createTask({ title: 'Test', projectId: '123' })
    const isValid = validateAgainstOpenAPI(response, 'Task')
    expect(isValid).toBe(true)
  })
})
```

**Tools for OpenAPI validation:**

- `openapi-validator` - JavaScript/TypeScript OpenAPI validator
- `ajv` with OpenAPI schema
- Manual Zod schema comparison

### 4.2 Parameter Compliance Check

For each tool, verify:

1. **Path Parameters:** Extract from URL pattern `/resource/{id}`
2. **Query Parameters:** Check spec for `in: query`
3. **Body Parameters:** Check spec for `requestBody`
4. **Required vs Optional:** Match spec `required: [...]` arrays

**Verification script:**

```bash
# Compare implementation parameters with OpenAPI spec
./scripts/verify-api-compliance.sh create_task
```

### 4.3 Response Schema Compliance

Compare Zod schemas with OpenAPI spec:

| Zod Schema     | OpenAPI Property | Status |
| -------------- | ---------------- | ------ |
| `z.string()`   | `type: string`   | Match  |
| `z.number()`   | `type: number`   | Match  |
| `z.boolean()`  | `type: boolean`  | Match  |
| `z.nullable()` | `nullable: true` | Match  |
| `z.optional()` | Not in required  | Match  |

---

## 5. Integration Testing Strategy

### 5.1 Test Environment Setup

1. **Local Kaneo Instance:**

   ```bash
   docker-compose up kaneo-api
   ```

2. **Test Data Seeding:**

   ```typescript
   beforeAll(async () => {
     // Create test workspace
     // Create test project
     // Create test labels
     // Create test tasks
   })
   ```

3. **Test Isolation:**
   - Each test uses unique IDs
   - Cleanup after each test
   - Transaction rollback support

### 5.2 Critical Path Integration Tests

Test the full user workflow:

```
1. Create project
2. Create task in project
3. Update task status
4. Add comment to task
5. Create label
6. Add label to task
7. Archive task
8. List tasks (verify archived task present)
9. Archive project
10. List projects (verify archived project gone)
```

### 5.3 Error Scenarios

Test against real API error responses:

```
1. Expired/invalid API key → 401
2. Non-existent resource → 404
3. Invalid parameters → 400
4. Rate limiting → 429
5. Server errors → 500, 502, 503
```

---

## 6. Continuous Compliance Monitoring

### 6.1 Automated Checks

Add to CI/CD pipeline:

```yaml
# .github/workflows/api-compliance.yml
name: API Compliance
on: [push, pull_request]
jobs:
  verify:
    steps:
      - name: Download latest OpenAPI spec
        run: curl -o openapi.json https://kaneo.app/docs/openapi.json

      - name: Verify schema compliance
        run: bun run test:compliance

      - name: Check for API changes
        run: bun run test:api-diff
```

### 6.2 Change Detection

Monitor Kaneo API for changes:

```typescript
// nightly-api-check.ts
async function checkForApiChanges() {
  const currentSpec = await fetch('https://kaneo.app/docs/openapi.json')
  const cachedSpec = await readFile('./cached-openapi.json')

  if (hash(currentSpec) !== hash(cachedSpec)) {
    // Alert developers
    sendAlert('Kaneo API specification changed!')
  }
}
```

### 6.3 Compliance Dashboard

Track compliance metrics:

```
┌────────────────────────────────────────┐
│ API Compliance Dashboard               │
├────────────────────────────────────────┤
│ Overall: 75% ████████████░░░░░░░░░     │
│                                        │
│ By Category:                           │
│ - Projects: 100% ████████████          │
│ - Tasks: 85% ██████████░░░             │
│ - Labels: 100% ████████████            │
│ - Comments: 100% ████████████          │
│ - Columns: 20% ██░░░░░░░░░░            │
│ - Missing: 0%                          │
│                                        │
│ Last Checked: 2026-03-12               │
└────────────────────────────────────────┘
```

---

## 7. Manual Verification Procedures

### 7.1 Before Each Release

**Pre-release Checklist:**

- [ ] All unit tests pass
- [ ] Integration tests pass against staging API
- [ ] Schema validation passes for all tools
- [ ] Manual smoke tests complete
- [ ] Error handling verified for all error codes
- [ ] Documentation updated

**Smoke Test Script:**

```bash
#!/bin/bash
# smoke-test.sh

echo "Testing core workflow..."

# Create project
PROJECT=$(curl -X POST $API/project -d '{"name":"Test","workspaceId":"ws1","icon":"","slug":"test"}')
PROJECT_ID=$(echo $PROJECT | jq -r '.id')

# Create task
TASK=$(curl -X POST $API/task/$PROJECT_ID -d '{"title":"Test task","description":"","priority":"medium","status":"todo"}')
TASK_ID=$(echo $TASK | jq -r '.id')

# Update task
curl -X PUT $API/task/$TASK_ID -d '{"title":"Updated","description":"","priority":"high","status":"in-progress","projectId":"'$PROJECT_ID'","position":0}'

# Add comment
curl -X POST $API/activity/comment -d '{"taskId":"'$TASK_ID'","comment":"Test comment"}'

# Search
curl "$API/search?q=test&workspaceId=ws1"

echo "✓ Smoke tests complete"
```

### 7.2 API Drift Detection

Compare implemented endpoints with latest spec:

```
Implemented but not in spec: (potential deprecation)
- None found

In spec but not implemented: (missing features)
- DELETE /task/{id} (hard delete)
- POST /column/{projectId} (create column)
- PUT /column/{id} (update column)
- DELETE /column/{id} (delete column)
- PUT /column/reorder/{projectId} (reorder columns)
- GET /task/export/{projectId} (export tasks)
- POST /task/import/{projectId} (import tasks)
```

---

## 8. Test Coverage Requirements

### 8.1 Coverage Targets

| Component         | Target | Current |
| ----------------- | ------ | ------- |
| Unit Tests        | 80%    | 75%     |
| Integration Tests | 60%    | 30%     |
| Error Handling    | 100%   | 90%     |
| Schema Validation | 100%   | 100%    |

### 8.2 Coverage by Tool

| Tool         | Lines | Branches | Functions |
| ------------ | ----- | -------- | --------- |
| create_task  | 90%   | 85%      | 100%      |
| update_task  | 85%   | 80%      | 100%      |
| archive_task | 75%   | 70%      | 100%      |
| ...          | ...   | ...      | ...       |

---

## 9. Debugging Failed Tests

### 9.1 Test Failure Categories

**Category 1: Schema Mismatch**

```
Error: Expected field "workspaceId" not in response
Fix: Update Zod schema to include workspaceId
```

**Category 2: Parameter Error**

```
Error: Required parameter "workspaceId" missing
Fix: Pass workspaceId as query parameter in GET call
```

**Category 3: HTTP Method Error**

```
Error: Expected PUT but implementation uses PATCH
Fix: Update HTTP method to match API spec
```

**Category 4: Error Classification Error**

```
Error: 404 returned but classified as server-error
Fix: Update classify-error.ts to map 404 to not-found
```

### 9.2 Debugging Checklist

When a test fails:

1. [ ] Check actual vs expected HTTP method
2. [ ] Verify all required parameters are passed
3. [ ] Check parameter location (path/query/body)
4. [ ] Validate request body structure
5. [ ] Verify response schema matches spec
6. [ ] Check error handling and classification
7. [ ] Review logs for actual API response

---

## 10. Summary & Next Steps

### 10.1 Immediate Actions Required

**High Priority (Critical):**

1. ✅ Fix update_project (workspaceId issue) - COMPLETED
2. ⬜ Add missing required parameter checks for all tools
3. ⬜ Implement schema validation tests for all responses
4. ⬜ Add integration tests for error scenarios

**Medium Priority:**

1. ⬜ Implement hard delete task tool (DELETE /task/{id})
2. ⬜ Add column management tools
3. ⬜ Create API compliance monitoring script

**Low Priority:**

1. ⬜ Add time entry support
2. ⬜ Implement task import/export
3. ⬜ Add GitHub integration tools

### 10.2 Compliance Verification Checklist

For each tool, verify:

- [ ] Correct HTTP method
- [ ] All required parameters passed
- [ ] Parameters in correct location (path/query/body)
- [ ] Response schema validated
- [ ] Error codes properly classified
- [ ] Test coverage > 80%
- [ ] Integration test passes
- [ ] Documentation accurate

**Current Status:**

- ✅ Completed: 1/24 tools (update_project fixed)
- ⏳ Remaining: 23 tools to verify

---

---

## 11. Mock Patterns

### 11.1 When to Use Each Pattern

| Pattern                           | Use When                                                  | Example                                                |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `setMockFetch` / `restoreFetch`   | HTTP-level provider tests (Kaneo, YouTrack)               | `tests/test-helpers.ts`                                |
| `mock.module()` with mutable impl | Replacing modules before import (AI SDK, drizzle, logger) | `tests/conversation.test.ts`                           |
| `spyOn()`                         | Partial mocking where you need original module behavior   | `tests/conversation.test.ts` `buildMessagesWithMemory` |

### 11.2 `setMockFetch` / `restoreFetch` (HTTP mocking)

Centralised in `tests/test-helpers.ts`. Use for all provider tests that need to intercept `fetch()`.

```typescript
import { setMockFetch, restoreFetch } from '../../test-helpers.js'

afterEach(() => {
  restoreFetch()
})

test('fetches data', async () => {
  setMockFetch(async (url, init) => {
    return new Response(JSON.stringify({ id: '1' }), { status: 200 })
  })
  // ...test logic...
})
```

### 11.3 `mock.module()` with Mutable Implementation

Use when replacing entire modules (AI SDK, database, logger). Define a mutable `let impl` variable so tests can override behavior per-test, with a named default restored in `beforeEach`.

```typescript
const defaultImpl = (): Promise<Result> =>
  Promise.resolve({
    /* default */
  })
let impl = defaultImpl

void mock.module('some-module', () => ({
  someFunction: (...args: unknown[]) => impl(...args),
}))

describe('tests', () => {
  beforeEach(() => {
    impl = defaultImpl // reset to prevent cross-test leaks
  })

  test('custom behavior', () => {
    impl = () => Promise.reject(new Error('fail'))
    // ...test logic...
  })
})
```

### 11.4 `spyOn()` (Partial Module Mocking)

Use when you need to override specific exports while keeping the rest of the module intact. Always create spies in `beforeEach` and restore in `afterEach` — never inline in test bodies.

```typescript
let mySpy: ReturnType<typeof spyOn>

beforeEach(() => {
  mySpy = spyOn(module, 'fn').mockReturnValue('mocked')
})

afterEach(() => {
  mySpy.mockRestore()
})
```

### 11.5 Mandatory Cleanup Rules

1. **`afterEach(() => restoreFetch())`** — always restore fetch after HTTP mock tests
2. **`afterEach(() => spy.mockRestore())`** — always restore spies in `afterEach`, not inline
3. **`afterAll(() => { mock.restore() })`** — when `mock.module()` mocks modules shared by other test files
4. **`beforeEach(() => impl = defaultImpl)`** — reset mutable impls to prevent cross-test state leaks

---

_Document generated: 2026-03-12_
_Mock patterns section added: 2026-03-23_
_Based on: API_COMPLIANCE_ANALYSIS.md_
_Next review: On next API change or monthly_
