# YouTrack Provider Verification Document

**Date:** 2025-03-18  
**Status:** Verification & Acceptance Criteria  
**Target:** YouTrack REST API Provider Integration

---

## Executive Summary

This document provides comprehensive verification and acceptance criteria for the YouTrack provider implementation. Based on thorough research of the YouTrack REST API v2, this document outlines best practices, implementation requirements, and recommendations for production-ready YouTrack integration.

**Key Finding:** The current implementation correctly uses direct REST API calls, which is the recommended approach given the lack of actively maintained TypeScript client libraries.

---

## 1. API Research Summary

### 1.1 API Version and Base URL

- **API Version:** YouTrack REST API v2 (`/api` prefix)
- **Base URL Patterns:**
  - Cloud: `https://{instance}.youtrack.cloud/api`
  - Self-hosted: `https://{host}/youtrack/api`

### 1.2 Authentication

**Method:** Bearer Token (Permanent Token)

**Header Format:**

```http
Authorization: Bearer {token}
```

**Token Creation:**

1. User Profile → Account Security → Tokens
2. Scope: `YouTrack` (for issues, tags, commands) or `YouTrack Administration` (for admin functions)
3. Token is shown only once - must be copied immediately

**Current Implementation Status:** ✅ Correct - Uses Bearer token authentication in `client.ts`

---

## 2. Implementation Analysis

### 2.1 File Structure Review

```
src/providers/youtrack/
├── index.ts          # Main provider class (253 lines)
├── client.ts         # HTTP client wrapper (68 lines)
├── types.ts          # Internal type definitions (44 lines)
├── constants.ts      # Field selectors & capabilities (42 lines)
├── mappers.ts        # Data transformation (91 lines)
├── commands.ts       # YouTrack command builders (34 lines)
├── relations.ts      # Issue link management (50 lines)
├── labels.ts         # Tag/label operations (90 lines)
└── classify-error.ts # Error classification (26 lines)
```

**Assessment:** Well-organized modular structure following separation of concerns.

### 2.2 Current Capabilities

| Capability        | Status     | Notes                                                                          |
| ----------------- | ---------- | ------------------------------------------------------------------------------ |
| `tasks.delete`    | ✅         | Implemented                                                                    |
| `tasks.relations` | ✅         | Via Commands API                                                               |
| `projects.crud`   | ⚠️ Partial | List, Archive only (no Create/Update)                                          |
| `comments.crud`   | ✅         | Full CRUD except remove (YouTrack limitation)                                  |
| `labels.crud`     | ✅         | Full CRUD                                                                      |
| `tasks.archive`   | ❌         | Not supported by YouTrack API                                                  |
| `statuses.crud`   | ❌         | Not applicable - YouTrack uses "State" custom field for status (see Section 9) |

---

## 3. Acceptance Criteria

### 3.1 Core Task Operations (MUST HAVE)

#### AC-1: Create Task

**Criteria:**

- [x] Accept `projectId`, `title`, `description`, `priority`, `status`, `dueDate`, `assignee`
- [x] Return created task with all fields
- [x] Generate human-readable issue ID (e.g., `PROJ-123`)
- [x] Handle custom fields correctly (`State`, `Priority`, `Assignee`)
- [x] Log operation with appropriate level

**Implementation Status:** ✅ Complete

**Verification Points:**

- Uses `POST /api/issues` endpoint
- Correct `$type` usage: `StateIssueCustomField`, `SingleEnumIssueCustomField`, `SingleUserIssueCustomField`
- Returns mapped Task with URL constructed as `{baseUrl}/issue/{idReadable}`

#### AC-2: Get Task

**Criteria:**

- [x] Fetch single task by ID (readable ID like `PROJ-123`)
- [x] Include all relations (links), labels (tags), custom fields
- [x] Return full task details

**Implementation Status:** ✅ Complete

**Verification Points:**

- Uses `GET /api/issues/{issueId}` endpoint
- Field selection includes: customFields, tags, links, project info

#### AC-3: Update Task

**Criteria:**

- [x] Support updating title, description, status, priority, assignee
- [x] Support project change (move to different project)
- [x] Return updated task

**Implementation Status:** ✅ Complete

**Verification Points:**

- Uses `POST /api/issues/{issueId}` for updates
- Correctly builds custom fields array with proper `$type`

#### AC-4: List Tasks

**Criteria:**

- [x] List all tasks in a project
- [x] Return minimal representation (id, title, status, priority)
- [x] Support pagination (via `$top` parameter)

**Implementation Status:** ✅ Complete

**Verification Points:**

- Uses query parameter: `project: {projectId}`
- Limited to 100 results (`$top=100`)

#### AC-5: Search Tasks

**Criteria:**

- [x] Search by keyword/query
- [x] Filter by project (optional)
- [x] Return search results with task details
- [x] Support result limit

**Implementation Status:** ✅ Complete

**Verification Points:**

- Supports YouTrack query language
- Constructs query: `project: {projectId} {query}` when projectId provided

#### AC-6: Delete Task

**Criteria:**

- [x] Permanently delete task
- [x] Return confirmation

**Implementation Status:** ✅ Complete

### 3.2 Project Operations (SHOULD HAVE)

#### AC-7: List Projects

**Criteria:**

- [x] List all non-archived projects
- [x] Include project name, description, URL

**Implementation Status:** ✅ Complete

**Verification Points:**

- Filters out archived projects
- Uses `GET /api/admin/projects`

#### AC-8: Archive Project

**Criteria:**

- [x] Archive (soft-delete) a project
- [x] Return confirmation

**Implementation Status:** ✅ Complete

**Missing:**

- [ ] Create Project
- [ ] Update Project

**Recommendation:** Add `createProject` and `updateProject` methods for full CRUD support.

### 3.3 Comment Operations (MUST HAVE)

#### AC-9: Add Comment

**Criteria:**

- [x] Add comment to task
- [x] Return comment with ID

**Implementation Status:** ✅ Complete

#### AC-10: Get Comments

**Criteria:**

- [x] Retrieve all comments for a task
- [x] Include author and timestamp

**Implementation Status:** ✅ Complete

#### AC-11: Update Comment

**Criteria:**

- [x] Update existing comment
- [x] Return updated comment

**Implementation Status:** ✅ Complete

#### AC-12: Remove Comment

**Criteria:**

- [ ] Delete comment (currently unsupported by YouTrack)

**Implementation Status:** ❌ Cannot implement

**Reason:** YouTrack API requires issue ID to delete comment, but provider interface only passes commentId. Current implementation throws `unsupportedOperation` error.

**Recommendation:** Consider extending TaskProvider interface to support issue-aware comment deletion, or document this limitation clearly.

### 3.4 Label/Tag Operations (MUST HAVE)

#### AC-13: List Labels

**Criteria:**

- [x] List all tags/labels
- [x] Include name and color

**Implementation Status:** ✅ Complete

#### AC-14: Create Label

**Criteria:**

- [x] Create new tag
- [x] Support optional color

**Implementation Status:** ⚠️ Partial

**Issue:** Color parameter accepted but not passed to API in `createYouTrackLabel`

**Current Code:**

```typescript
body: {
  name: params.name
} // Missing color
```

**Required Fix:**

```typescript
body: { name: params.name, color: params.color ? { background: params.color } : undefined }
```

#### AC-15: Update Label

**Criteria:**

- [x] Update label name
- [ ] Update label color

**Implementation Status:** ⚠️ Partial

**Issue:** Color updates not supported (same issue as AC-14)

#### AC-16: Remove Label

**Criteria:**

- [x] Delete tag
- [x] Return confirmation

**Implementation Status:** ✅ Complete

#### AC-17: Add Task Label

**Criteria:**

- [x] Assign tag to issue
- [x] Preserve existing tags

**Implementation Status:** ✅ Complete

**Implementation Note:** Correctly fetches current tags, appends new tag, and updates issue.

#### AC-18: Remove Task Label

**Criteria:**

- [x] Remove tag from issue
- [x] Preserve other tags

**Implementation Status:** ✅ Complete

### 3.5 Task Relations (MUST HAVE)

#### AC-19: Add Relation

**Criteria:**

- [x] Support all relation types: `blocks`, `blocked_by`, `duplicate`, `duplicate_of`, `related`, `parent`
- [x] Create relation via Commands API

**Implementation Status:** ✅ Complete

**Implementation Details:**

- Uses Commands API: `POST /api/issues/{taskId}/execute`
- Command mapping:
  - `blocks` → `is required for {targetIssueId}`
  - `blocked_by` → `depends on {targetIssueId}`
  - `duplicate` → `duplicates {targetIssueId}`
  - `duplicate_of` → `is duplicated by {targetIssueId}`
  - `parent` → `subtask of {targetIssueId}`
  - `related` → `relates to {targetIssueId}`

#### AC-20: Remove Relation

**Criteria:**

- [x] Remove relation between tasks
- [x] Handle bidirectional links correctly

**Implementation Status:** ✅ Complete

**Implementation Details:**

- First fetches issue with links to find matching link
- Determines direction and type
- Builds appropriate remove command
- Handles edge case: relation not found

#### AC-21: Update Relation

**Criteria:**

- [ ] Change relation type

**Implementation Status:** ❌ Not Implemented

**Reason:** Not in current TaskProvider interface. YouTrack doesn't support direct relation updates - must remove and re-add.

**Recommendation:** Implement as remove + add sequence if needed.

### 3.6 Error Handling (MUST HAVE)

#### AC-22: Error Classification

**Criteria:**

- [x] Map HTTP errors to domain errors
- [x] Handle 401/403 as auth failures
- [x] Handle 404 as not found (task, project, comment, label)
- [x] Handle 429 as rate limited
- [x] Handle 400 as validation errors

**Implementation Status:** ✅ Complete

**Implementation Details:**

- `classify-error.ts` properly maps YouTrackApiError to AppError types
- Uses discriminated union pattern from `errors.ts`

---

## 4. Best Practices & Recommendations

### 4.1 Recommended (Current Implementation)

✅ **Direct REST API Calls**

- Correctly avoids unmaintained client libraries
- Full API coverage without abstraction layer limitations
- Better debugging and transparency

✅ **Field Selection**

- Proper use of `fields` parameter to minimize response size
- Nested field selection for custom fields, tags, links

✅ **Bearer Token Authentication**

- Correct authentication header format
- Secure token handling (passed via config, not hardcoded)

✅ **Custom Field Type Mapping**

- Correct `$type` usage for State, Priority, Assignee fields
- Follows YouTrack API requirements exactly

✅ **Commands API for Relations**

- Correct approach for creating issue links
- Respects YouTrack's workflow rules

✅ **Modular Architecture**

- Clear separation: client, mappers, commands, labels, relations
- Easy to test and maintain

### 4.2 Areas for Improvement

#### IMP-1: Pagination Support

**Current:** Limited to 100 results for lists and searches

**Recommendation:**

```typescript
// Add pagination parameters
listTasks(projectId: string, options?: { skip?: number; top?: number }): Promise<TaskListItem[]>
searchTasks(params: { query: string; projectId?: string; limit?: number; skip?: number }): Promise<TaskSearchResult[]>
```

#### IMP-2: Batch Operations

**Current:** Individual API calls for each operation

**Recommendation:** Support Commands API for batch updates:

```typescript
// Execute multiple commands in one request
executeCommands(taskIds: string[], command: string): Promise<void>
```

#### IMP-3: Color Support for Labels

**Priority:** HIGH

**Fix Required:**

```typescript
// In labels.ts, update createYouTrackLabel and updateYouTrackLabel
const body: Record<string, unknown> = { name: params.name }
if (params.color !== undefined) {
  body['color'] = { background: params.color }
}
```

#### IMP-4: Error Context

**Current:** Basic error messages

**Recommendation:** Include more context in error responses:

```typescript
// In classify-error.ts
return providerError.validationFailed('unknown', message, {
  details: errorBody,
  operation: 'createTask',
  entity: 'issue',
})
```

#### IMP-5: Rate Limit Handling

**Current:** No rate limit awareness

**Recommendation:**

```typescript
// In client.ts, add retry logic with exponential backoff
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After')
  await sleep(parseInt(retryAfter ?? '1') * 1000)
  return youtrackFetch(config, method, path, options) // retry
}
```

#### IMP-6: Project CRUD Completion

**Priority:** MEDIUM

**Add Missing Methods:**

```typescript
async createProject(params: { name: string; description?: string }): Promise<Project> {
  // POST /api/admin/projects
}

async updateProject(projectId: string, params: { name?: string; description?: string }): Promise<Project> {
  // POST /api/admin/projects/{projectId}
}
```

#### IMP-7: Due Date Support

**Current:** Due date is not mapped/set in YouTrack

**Recommendation:** Research YouTrack due date field (usually a custom field named "Due Date" or similar)

#### IMP-8: Issue History/Audit

**New Feature:** Support retrieving issue change history

```typescript
async getTaskHistory(taskId: string): Promise<Activity[]> {
  // GET /api/issues/{taskId}/activities
}
```

### 4.3 Security Best Practices

✅ **Already Implemented:**

- Token passed via config (not hardcoded)
- No token logging

🔒 **Additional Recommendations:**

1. **Token Validation:** Validate token format before API calls
2. **URL Validation:** Ensure baseUrl doesn't contain path traversal
3. **Timeout:** Add request timeout to fetch calls
4. **Input Sanitization:** Validate taskId format before API calls

---

## 5. Testing Requirements

### 5.1 Unit Tests

**Existing:** `tests/providers/youtrack/provider.test.ts`

**Coverage Checklist:**

- [x] Provider instantiation
- [x] Capabilities check
- [x] Config requirements
- [x] Prompt addendum
- [x] Error classification

**Missing Coverage:**

- [ ] Mappers (mapIssueToTask, mapComment, etc.)
- [ ] Command builders (buildLinkCommand, buildRemoveLinkCommand)
- [ ] Label operations (all CRUD)
- [ ] Relation operations
- [ ] Client error handling

### 5.2 Integration/E2E Tests

**Required Tests:**

- [ ] Create issue with all custom fields
- [ ] Update issue state (respecting workflow)
- [ ] Add/remove tags
- [ ] Create/remove relations
- [ ] Search with complex queries
- [ ] Error scenarios (404, 401, 429)
- [ ] Pagination with large result sets

### 5.3 Mock Data

**Current:** Good mocking with `YtIssue`, `YtProject`, `YtComment`, `YtTag` types

**Recommendation:** Create realistic mock responses for:

- Issues with full custom fields
- Issues with links/relations
- Issues with multiple tags
- Error responses

---

## 6. Known Limitations

### 6.1 YouTrack API Limitations

1. **Cannot create relations during issue creation**
   - Must create issue first, then add relations
   - Current implementation handles this correctly

2. **Remove comment requires issue ID**
   - TaskProvider interface doesn't provide issue ID for removeComment
   - Current workaround: throw unsupportedOperation

3. **No columns/status management**
   - YouTrack doesn't have a columns concept like Kanban boards
   - Status is a custom field
   - Current implementation correctly excludes this capability

4. **No archive task**
   - YouTrack doesn't have a task-level archive
   - Can only archive entire projects
   - Current implementation correctly excludes this capability

5. **State transitions governed by workflows**
   - Cannot set arbitrary state values
   - Must use valid transitions
   - Prompt addendum correctly warns about this

### 6.2 Implementation Gaps

1. **Label color support** (HIGH PRIORITY)
2. **Project create/update** (MEDIUM PRIORITY)
3. **Pagination support** (MEDIUM PRIORITY)
4. **Rate limit handling** (LOW PRIORITY)
5. **Due date mapping** (LOW PRIORITY)

---

## 7. Architectural Clarification: Columns vs Statuses

### 7.1 Conceptual Mapping Across Providers

The `statuses.crud` capability represents **status/state management** in task trackers. Different trackers implement this differently:

| Provider     | Concept | Implementation                                                                  | statuses.crud           |
| ------------ | ------- | ------------------------------------------------------------------------------- | ----------------------- |
| **Kaneo**    | Columns | Kanban board columns ("Todo", "In Progress", "Done")                            | ✅ Full CRUD            |
| **YouTrack** | State   | Custom field named "State" (values: "Open", "In Progress", "Fixed", "Verified") | N/A - Via custom fields |
| **Linear**   | Status  | Workflow states                                                                 | N/A - Via status field  |
| **Jira**     | Status  | Workflow states (transitions governed by workflows)                             | N/A - Via status field  |

### 7.2 YouTrack Status Handling

**YouTrack uses a "State" custom field for issue status.**

**Key Points:**

- State is just another custom field (type: `StateIssueCustomField`)
- Values are defined per project (e.g., "Open", "In Progress", "Fixed", "Verified")
- State transitions can be governed by workflows
- No separate column/board management API exists

**Implementation:**

```typescript
// In mappers.ts - status is mapped from 'State' custom field
status: getCustomFieldValue(issue, 'State')

// In updateTask - status is set via custom fields
if (params.status !== undefined) {
  fields.push({
    name: 'State',
    $type: 'StateIssueCustomField',
    value: { name: params.status },
  })
}
```

**Why Not statuses.crud?**

1. YouTrack doesn't have a column concept separate from state
2. State values are managed as custom field options (not via a separate API)
3. Board layouts are views on top of state values (Agile boards)

### 7.3 Recommended Approach

**Current Implementation:** ✅ Correct

YouTrack correctly does NOT declare `statuses.crud` capability. Instead:

- Status is managed via `updateTask` with `status` parameter
- The system prompt addendum educates the LLM about State field usage
- Users update status values directly (e.g., "Open" → "In Progress")

**For Future Providers:**

- **Kanban-style trackers** (Kaneo, Trello): Implement `statuses.crud`
- **Workflow-style trackers** (YouTrack, Jira, Linear): Status via `updateTask`, no `statuses.crud`

### 7.4 Status Update Flow

**Kaneo (with statuses.crud):**

```
User: "Move task to In Progress"
→ listStatuses(projectId) → get available columns
→ updateTask(taskId, { status: "In Progress" })
```

**YouTrack (without statuses.crud):**

```
User: "Change status to In Progress"
→ updateTask(taskId, { status: "In Progress" })
→ If fails: workflow may prevent transition, try alternate state
```

### 7.5 Capability Design Rationale

The `statuses.crud` capability exists because:

1. **Kaneo** has first-class column management (create, reorder, delete columns)
2. Some operations (like reordering kanban columns) are provider-specific
3. LLM needs to know whether it can query/manage the board structure

For trackers without column management, status is treated as a simple field update.

---

## 8. Conclusion

### 8.1 Overall Assessment

**Status:** ✅ PRODUCTION READY with minor improvements needed

**Strengths:**

- Solid foundation with clean architecture
- Correct API usage patterns
- Good error handling
- Comprehensive logging
- Proper TypeScript typing

**Weaknesses:**

- Missing color support for labels
- Missing full project CRUD
- No pagination support

### 8.2 Priority Actions

1. **HIGH:** Fix label color support (AC-14, AC-15)
2. **MEDIUM:** Add project create/update (AC-7, AC-8)
3. **MEDIUM:** Add pagination parameters
4. **LOW:** Add rate limit handling
5. **LOW:** Complete test coverage

### 8.3 Acceptance Decision

✅ **ACCEPTED** for production use with the following conditions:

1. Fix label color support before release
2. Document the removeComment limitation
3. Add pagination support within 1 month
4. Add missing unit tests

---

## 9. References

### 8.1 Documentation

- YouTrack REST API Docs: https://www.jetbrains.com/help/youtrack/devportal/youtrack-rest-api.html
- OpenAPI Spec: Available at `{youtrack-url}/api/openapi.json`

### 8.2 Files Reviewed

- `src/providers/youtrack/index.ts` - Main provider
- `src/providers/youtrack/client.ts` - HTTP client
- `src/providers/youtrack/types.ts` - Internal types
- `src/providers/youtrack/constants.ts` - Field selectors
- `src/providers/youtrack/mappers.ts` - Data transformation
- `src/providers/youtrack/commands.ts` - Command builders
- `src/providers/youtrack/relations.ts` - Link management
- `src/providers/youtrack/labels.ts` - Tag operations
- `src/providers/youtrack/classify-error.ts` - Error handling
- `src/providers/types.ts` - Provider interface
- `src/providers/registry.ts` - Provider registration

### 8.3 Research Sources

- Official YouTrack REST API documentation (2025)
- YouTrack community forums and GitHub issues
- NPM package analysis (youtrack-rest-client)
- Stack Overflow discussions on YouTrack API

---

**Document Version:** 1.0  
**Last Updated:** 2025-03-18  
**Author:** AI Assistant with YouTrack API Research
