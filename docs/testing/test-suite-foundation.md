# Test Suite Foundation: Plane Migration & E2E Testing

**Date:** March 10, 2026  
**Purpose:** Test architecture for migrating Linear data to Plane and validating Plane E2E functionality

---

## Executive Summary

This test suite validates:
1. **Migration Tests**: Linear data correctly transforms and imports to Plane
2. **Plane E2E Tests**: Plane implementation works correctly with real API calls

**Key Principles:**
1. Test against real APIs (no mocks)
2. Focus on data transformation correctness
3. Validate end-to-end Plane workflows
4. Test error handling with real API responses
5. Document migration edge cases

---

## Architecture Overview

### Test Categories

| Category | Purpose | Target |
|----------|---------|--------|
| **Migration Tests** | Validate Linear→Plane data transformation | 22 Linear methods mapped to Plane equivalents |
| **Plane E2E Tests** | Test Plane API functionality end-to-end | Real Plane API workflows |
| **Integration Tests** | Cross-system data flow | Linear export → Plane import |

### Test Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Migration Test Suite                      │
│                                                              │
│  ┌──────────────────┐          ┌─────────────────────┐    │
│  │  Linear API       │          │   Plane API         │    │
│  │  (Real/Export)    │  ──────→ │   (Real API calls)  │    │
│  │                   │Transform  │                     │    │
│  └──────────────────┘          └─────────────────────┘    │
│                                                              │
│  Validation:                                                 │
│  - Data integrity preserved                                  │
│  - Field mappings correct                                    │
│  - Relations maintained                                      │
│  - Errors handled gracefully                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Plane E2E Test Suite                      │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Real Plane API Calls                    │    │
│  │                                                     │    │
│  │  Work Items → Projects → Labels → Relations        │    │
│  │       ↓                                               │    │
│  │  Create → Update → Query → Delete                  │    │
│  │                                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Validation:                                                 │
│  - CRUD operations work                                      │
│  - API responses correct                                     │
│  - Error handling proper                                     │
│  - Workflows functional                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Test Suite Structure

### Directory Layout

```
tests/
├── migration/                    # Linear → Plane migration tests
│   ├── create-issue.test.ts
│   ├── update-issue.test.ts
│   ├── search-issues.test.ts
│   ├── list-projects.test.ts
│   ├── archive-issue.test.ts
│   └── ... (22 files total)
├── e2e/                        # Plane E2E tests
│   ├── work-items/
│   │   ├── create.test.ts
│   │   ├── update.test.ts
│   │   ├── list.test.ts
│   │   └── relations.test.ts
│   ├── projects/
│   │   ├── create.test.ts
│   │   ├── list.test.ts
│   │   └── archive.test.ts
│   ├── labels/
│   │   ├── create.test.ts
│   │   └── list.test.ts
│   └── workflows/
│       ├── issue-lifecycle.test.ts
│       └── project-management.test.ts
├── fixtures/                   # Test data
│   └── datasets/
│       ├── priority-mappings.ts
│       ├── relation-mappings.ts
│       ├── state-mappings.ts
│       └── sample-linear-data.ts
├── utils/                      # Test utilities
│   ├── test-helpers.ts
│   ├── plane-client.ts
│   └── data-transformers.ts
└── setup.ts                    # Test configuration
```

### Test File Naming Convention

```
{scope}/{resource}.{action}.test.ts

Examples:
- migration/create-issue.test.ts          # Migration test
- e2e/work-items/create.test.ts          # Plane E2E test
- e2e/workflows/issue-lifecycle.test.ts   # Workflow test
```

---

## Test Fixtures & Data

### Data Mappings

```typescript
// tests/fixtures/datasets/priority-mappings.ts
export const LINEAR_TO_PLANE_PRIORITY: Record<number, string> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
}

// tests/fixtures/datasets/relation-mappings.ts
export const LINEAR_TO_PLANE_RELATION: Record<string, string> = {
  blocks: 'blocking',
  blockedBy: 'blocked_by',
  duplicate: 'duplicate',
  related: 'relates_to',
}

// tests/fixtures/datasets/sample-linear-data.ts
export const SAMPLE_LINEAR_ISSUE = {
  id: 'issue-123',
  identifier: 'TEAM-42',
  title: 'Fix authentication bug',
  description: 'Users cannot login with SSO',
  priority: 2, // high
  state: { name: 'In Progress' },
  labels: ['bug', 'auth'],
  dueDate: '2025-03-15',
  estimate: 5,
  projectId: 'proj-456',
  teamId: 'team-123',
}
```

### Environment Configuration

```typescript
// tests/setup.ts
export const TEST_CONFIG = {
  plane: {
    apiKey: process.env.PLANE_TEST_API_KEY || '',
    workspaceSlug: process.env.PLANE_TEST_WORKSPACE || 'test-workspace',
    baseUrl: process.env.PLANE_TEST_URL || 'http://localhost:3000',
  },
  linear: {
    apiKey: process.env.LINEAR_TEST_API_KEY || '',
    teamId: process.env.LINEAR_TEST_TEAM_ID || '',
  },
}

export function skipIfNoPlaneApi() {
  if (!TEST_CONFIG.plane.apiKey) {
    throw new Error('PLANE_TEST_API_KEY not set. Skipping E2E tests.')
  }
}
```

---

## Migration Tests

### Pattern 1: Data Transformation Test

```typescript
// tests/migration/create-issue.test.ts
import { describe, expect, test, beforeAll } from 'bun:test'
import { PlaneClient } from '@makeplane/plane-node-sdk'
import { TEST_CONFIG, skipIfNoPlaneApi } from '../setup.js'
import { LINEAR_TO_PLANE_PRIORITY } from '../fixtures/datasets/priority-mappings.js'
import { SAMPLE_LINEAR_ISSUE } from '../fixtures/datasets/sample-linear-data.js'

describe('createIssue Migration', () => {
  let client: PlaneClient
  let projectId: string

  beforeAll(() => {
    skipIfNoPlaneApi()
    client = new PlaneClient({ apiKey: TEST_CONFIG.plane.apiKey })
    projectId = TEST_CONFIG.plane.projectId
  })

  test('transforms Linear issue to Plane work item', async () => {
    const linearIssue = SAMPLE_LINEAR_ISSUE

    // Transform Linear data to Plane format
    const planeInput = {
      name: linearIssue.title,
      description_html: `<p>${linearIssue.description}</p>`,
      priority: LINEAR_TO_PLANE_PRIORITY[linearIssue.priority],
      target_date: linearIssue.dueDate,
      estimate_point: String(linearIssue.estimate),
      labels: linearIssue.labels,
    }

    // Create in Plane
    const workItem = await client.workItems.create(
      TEST_CONFIG.plane.workspaceSlug,
      projectId,
      planeInput
    )

    // Verify transformation
    expect(workItem.name).toBe(linearIssue.title)
    expect(workItem.priority).toBe('high')
    expect(workItem.estimate_point).toBe('5')
    expect(workItem.description_html).toContain(linearIssue.description)
  })

  test('handles missing optional fields', async () => {
    const minimalLinearIssue = {
      title: 'Quick fix',
      teamId: 'team-123',
    }

    const workItem = await client.workItems.create(
      TEST_CONFIG.plane.workspaceSlug,
      projectId,
      { name: minimalLinearIssue.title }
    )

    expect(workItem.name).toBe(minimalLinearIssue.title)
    expect(workItem.priority).toBeNull()
    expect(workItem.description_html).toBeNull()
  })
})
```

### Pattern 2: Relation Migration Test

```typescript
// tests/migration/issue-relations.test.ts
import { describe, expect, test } from 'bun:test'
import { LINEAR_TO_PLANE_RELATION } from '../fixtures/datasets/relation-mappings.js'

describe('Issue Relations Migration', () => {
  test('maps Linear relation types to Plane', () => {
    const testCases = [
      { linear: 'blocks', plane: 'blocking' },
      { linear: 'blockedBy', plane: 'blocked_by' },
      { linear: 'duplicate', plane: 'duplicate' },
      { linear: 'related', plane: 'relates_to' },
    ]

    for (const { linear, plane } of testCases) {
      expect(LINEAR_TO_PLANE_RELATION[linear]).toBe(plane)
    }
  })

  test('creates relations in Plane', async () => {
    // Create two issues
    const issue1 = await client.workItems.create(workspace, project, { name: 'Issue 1' })
    const issue2 = await client.workItems.create(workspace, project, { name: 'Issue 2' })

    // Create relation (blocks)
    await client.workItems.relations.create(workspace, project, issue1.id, {
      relation_type: 'blocking',
      related_issue: issue2.id,
    })

    // Verify relation
    const relations = await client.workItems.relations.list(workspace, project, issue1.id)
    expect(relations.blocking).toContain(issue2.id)
  })
})
```

---

## Plane E2E Tests

### Pattern 1: CRUD Operations

```typescript
// tests/e2e/work-items/create.test.ts
import { describe, expect, test, beforeAll } from 'bun:test'
import { PlaneClient } from '@makeplane/plane-node-sdk'
import { TEST_CONFIG, skipIfNoPlaneApi } from '../../setup.js'

describe('Work Item CRUD', () => {
  let client: PlaneClient
  let workspace: string
  let project: string

  beforeAll(() => {
    skipIfNoPlaneApi()
    client = new PlaneClient({ apiKey: TEST_CONFIG.plane.apiKey })
    workspace = TEST_CONFIG.plane.workspaceSlug
    project = TEST_CONFIG.plane.projectId
  })

  test('creates work item with all fields', async () => {
    const workItem = await client.workItems.create(workspace, project, {
      name: 'Complete feature',
      description_html: '<p>Implement user authentication</p>',
      priority: 'high',
      target_date: '2025-03-15',
      estimate_point: '5',
      labels: ['feature', 'auth'],
    })

    expect(workItem.id).toBeDefined()
    expect(workItem.name).toBe('Complete feature')
    expect(workItem.sequence_id).toBeGreaterThan(0)
    expect(workItem.priority).toBe('high')
    expect(workItem.target_date).toBe('2025-03-15')
    expect(workItem.estimate_point).toBe('5')
  })

  test('updates work item', async () => {
    const created = await client.workItems.create(workspace, project, {
      name: 'Original title',
    })

    const updated = await client.workItems.update(workspace, project, created.id, {
      name: 'Updated title',
      priority: 'urgent',
    })

    expect(updated.name).toBe('Updated title')
    expect(updated.priority).toBe('urgent')
  })

  test('lists work items', async () => {
    const response = await client.workItems.list(workspace, project, { limit: 10 })
    
    expect(response.results).toBeDefined()
    expect(Array.isArray(response.results)).toBe(true)
    expect(response.count).toBeGreaterThanOrEqual(0)
  })

  test('deletes work item', async () => {
    const workItem = await client.workItems.create(workspace, project, {
      name: 'To be deleted',
    })

    await client.workItems.delete(workspace, project, workItem.id)

    // Verify deletion
    const retrieved = await client.workItems.retrieve(workspace, project, workItem.id)
    expect(retrieved).toBeNull()
  })
})
```

### Pattern 2: Workflow Tests

```typescript
// tests/e2e/workflows/issue-lifecycle.test.ts
import { describe, expect, test } from 'bun:test'

describe('Issue Lifecycle Workflow', () => {
  test('complete lifecycle: create → update → complete → archive', async () => {
    // 1. Create
    const issue = await client.workItems.create(workspace, project, {
      name: 'Feature request',
      priority: 'medium',
    })

    // 2. Update - start work
    await client.workItems.update(workspace, project, issue.id, {
      state: 'In Progress',
    })

    // 3. Add comment
    await client.workItems.comments.create(workspace, project, issue.id, {
      body: 'Started implementation',
    })

    // 4. Complete
    await client.workItems.update(workspace, project, issue.id, {
      state: 'Done',
    })

    // 5. Verify completed
    const completed = await client.workItems.retrieve(workspace, project, issue.id)
    expect(completed!.state!.name).toBe('Done')

    // 6. Archive (if supported)
    // await client.workItems.archive(workspace, project, issue.id)
  })

  test('label management workflow', async () => {
    // Create labels
    const bugLabel = await client.labels.create(workspace, project, {
      name: 'bug',
      color: '#ff0000',
    })

    const featureLabel = await client.labels.create(workspace, project, {
      name: 'feature',
      color: '#00ff00',
    })

    // Create issue with labels
    const issue = await client.workItems.create(workspace, project, {
      name: 'Bug fix',
      labels: [bugLabel.id],
    })

    expect(issue.labels).toContain(bugLabel.id)

    // Add label
    await client.workItems.update(workspace, project, issue.id, {
      labels: [bugLabel.id, featureLabel.id],
    })

    // Verify
    const updated = await client.workItems.retrieve(workspace, project, issue.id)
    expect(updated!.labels).toContain(featureLabel.id)
  })
})
```

### Pattern 3: Error Handling

```typescript
// tests/e2e/errors/api-errors.test.ts
import { describe, expect, test } from 'bun:test'

describe('API Error Handling', () => {
  test('rejects invalid API key', async () => {
    const invalidClient = new PlaneClient({ apiKey: 'invalid-key' })
    
    await expect(
      invalidClient.workItems.create(workspace, project, { name: 'Test' })
    ).rejects.toThrow(/401|Unauthorized/)
  })

  test('rejects missing required fields', async () => {
    await expect(
      client.workItems.create(workspace, project, {} as any)
    ).rejects.toThrow(/400|Bad Request|required/)
  })

  test('rejects invalid priority values', async () => {
    await expect(
      client.workItems.create(workspace, project, {
        name: 'Test',
        priority: 'invalid-priority' as any,
      })
    ).rejects.toThrow(/400|Invalid/)
  })

  test('returns 404 for non-existent items', async () => {
    await expect(
      client.workItems.retrieve(workspace, project, 'non-existent-id')
    ).rejects.toThrow(/404|Not Found/)
  })
})
```

### Pattern 4: Internal API Endpoint Testing

**IMPORTANT**: Some Plane functionality relies on internal `/api/` endpoints that are not part of the public `/api/v1/` API. These must be tested with direct fetch calls.

#### Archive Endpoint Test

The archive endpoint `${baseUrl}/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${workItemId}/archive/` is an **internal endpoint** not exposed through the SDK.

**⚠️ CRITICAL**: Internal `/api/` endpoints use **session-based authentication** (cookies), NOT API keys. The source code confirms this:

```python
# plane/app/views/base.py:30-32
class BaseViewSet(TimezoneMixin, ModelViewSet, BasePaginator):
    authentication_classes = [BaseSessionAuthentication]  # ← Only session auth!
```

To test the archive endpoint, you must first authenticate via login to get a session cookie:

```typescript
// tests/e2e/internal/archive.test.ts
import { describe, expect, test, beforeAll } from 'bun:test'
import { PlaneClient } from '@makeplane/plane-node-sdk'
import { TEST_CONFIG, skipIfNoPlaneApi } from '../../setup.js'

// Helper to get session cookie via login
async function getSessionCookie(
  baseUrl: string,
  email: string,
  password: string
): Promise<string> {
  const loginResponse = await fetch(`${baseUrl}/api/sign-in/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  
  if (!loginResponse.ok) {
    throw new Error('Login failed')
  }
  
  const setCookieHeader = loginResponse.headers.get('set-cookie')
  if (!setCookieHeader) {
    throw new Error('No session cookie returned')
  }
  
  const sessionMatch = setCookieHeader.match(/sessionid=([^;]+)/)
  return sessionMatch ? sessionMatch[1] : ''
}

describe('Internal Archive Endpoint', () => {
  let client: PlaneClient
  let workspace: string
  let project: string
  let sessionCookie: string
  const baseUrl = TEST_CONFIG.plane.baseUrl
  const apiKey = TEST_CONFIG.plane.apiKey

  beforeAll(async () => {
    skipIfNoPlaneApi()
    client = new PlaneClient({ apiKey })
    workspace = TEST_CONFIG.plane.workspaceSlug
    project = TEST_CONFIG.plane.projectId
    
    // Get session cookie for internal API access
    sessionCookie = await getSessionCookie(
      baseUrl,
      process.env.PLANE_TEST_EMAIL!,
      process.env.PLANE_TEST_PASSWORD!
    )
  })

  test('archives completed work item via internal endpoint', async () => {
    // 1. Create a work item (public API uses API key)
    const issue = await client.workItems.create(workspace, project, {
      name: 'Test archive issue',
      priority: 'medium',
    })

    // 2. Move to completed state
    const states = await client.states.list(workspace, project)
    const completedState = states.results.find((s) => s.group === 'completed')
    expect(completedState).toBeDefined()

    await client.workItems.update(workspace, project, issue.id, {
      state: completedState!.id,
    })

    // 3. Archive via internal endpoint using SESSION COOKIE (not API key!)
    const archiveUrl = `${baseUrl}/api/workspaces/${workspace}/projects/${project}/issues/${issue.id}/archive/`
    const response = await fetch(archiveUrl, {
      method: 'POST',
      headers: {
        'Cookie': `sessionid=${sessionCookie}`,  // ← Session auth required
        'Content-Type': 'application/json',
      },
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.archived_at).toBeDefined()
    expect(data.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}$/) // YYYY-MM-DD format
  })

  test('rejects archiving non-completed work item', async () => {
    // Create issue without completing it
    const issue = await client.workItems.create(workspace, project, {
      name: 'Incomplete issue',
    })

    const archiveUrl = `${baseUrl}/api/workspaces/${workspace}/projects/${project}/issues/${issue.id}/archive/`
    const response = await fetch(archiveUrl, {
      method: 'POST',
      headers: {
        'Cookie': `sessionid=${sessionCookie}`,  // ← Session auth required
        'Content-Type': 'application/json',
      },
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('completed or cancelled')
  })

  test('unarchives work item via internal endpoint', async () => {
    // Setup: Create, complete, and archive an issue first...
    
    // Then unarchive using session cookie
    const unarchiveUrl = `${baseUrl}/api/workspaces/${workspace}/projects/${project}/issues/${issue.id}/archive/`
    const response = await fetch(unarchiveUrl, {
      method: 'DELETE',
      headers: {
        'Cookie': `sessionid=${sessionCookie}`,  // ← Session auth required
      },
    })

    expect(response.status).toBe(204) // No content on success
  })
})
```

**Required Environment Variables**:

```bash
# For session-based authentication on internal endpoints
PLANE_TEST_EMAIL=your-email@example.com
PLANE_TEST_PASSWORD=your-password
```

**Verification Notes**:
- This endpoint is documented in `@docs/plane/conflicts/archive-issue.md`
- The endpoint is **not** part of the public Plane API (`/api/v1/`)
- URL uses `/issues/` path (deprecated in public API but still used internally)
- Requires issue to be in "completed" or "cancelled" state before archiving
- **Authentication**: Internal `/api/` endpoints **require session cookies**, not API keys. Source code: `authentication_classes = [BaseSessionAuthentication]`
- API keys will return **401 Unauthorized** on these endpoints

---

## Environment Setup

### Required Environment Variables

```bash
# Plane Test Configuration
PLANE_TEST_API_KEY=your-plane-api-key
PLANE_TEST_WORKSPACE=your-test-workspace
PLANE_TEST_PROJECT_ID=your-test-project-id
PLANE_TEST_URL=http://localhost:3000  # or your instance URL

# Linear Test Configuration (for migration tests)
LINEAR_TEST_API_KEY=your-linear-api-key
LINEAR_TEST_TEAM_ID=your-linear-team-id
```

### Docker Compose for Local Testing

```yaml
# tests/docker-compose.yml
version: '3.8'
services:
  plane:
    image: makeplane/plane-frontend:stable
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
    depends_on:
      - plane-api
      - plane-db
      - plane-redis

  plane-api:
    image: makeplane/plane-backend:stable
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://plane:plane@plane-db:5432/plane
      - REDIS_URL=redis://plane-redis:6379
      - SECRET_KEY=your-secret-key

  plane-db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=plane
      - POSTGRES_PASSWORD=plane
      - POSTGRES_DB=plane
    volumes:
      - plane-data:/var/lib/postgresql/data

  plane-redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

volumes:
  plane-data:
  redis-data:
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

**Tasks:**
1. Create directory structure
2. Set up Plane SDK client wrapper
3. Create data mapping files
4. Write test configuration
5. Set up Docker Compose for local Plane instance

**Deliverables:**
- `tests/setup.ts` - Test configuration
- `tests/fixtures/datasets/` - Priority, relation, state mappings
- `tests/utils/plane-client.ts` - SDK wrapper
- `tests/docker-compose.yml` - Local Plane instance

### Phase 2: Migration Tests (Week 2)

**Tasks:**
1. Write data transformation tests for all 22 methods
2. Test field mappings
3. Test relation migrations
4. Document edge cases

**Deliverables:**
- `tests/migration/*.test.ts` - 22 migration test files
- `docs/migration/BEHAVIORAL_DIFFERENCES.md`
- `docs/migration/EDGE_CASES.md`

### Phase 3: Plane E2E Tests (Week 3)

**Tasks:**
1. Write CRUD tests for all Plane resources
2. Write workflow tests
3. Test error handling
4. Test edge cases

**Deliverables:**
- `tests/e2e/work-items/*.test.ts`
- `tests/e2e/projects/*.test.ts`
- `tests/e2e/labels/*.test.ts`
- `tests/e2e/workflows/*.test.ts`

### Phase 4: CI/CD Integration (Week 4)

**Tasks:**
1. Set up CI pipeline with Plane instance
2. Configure test runners
3. Add test reporting
4. Document usage

**Deliverables:**
- `.github/workflows/test.yml`
- Test documentation
- Coverage reports

---

## Running Tests

```bash
# Set up local Plane instance
docker-compose -f tests/docker-compose.yml up -d

# Run all tests
bun test

# Run migration tests only
bun test tests/migration/

# Run Plane E2E tests only
bun test tests/e2e/

# Run specific migration test
bun test tests/migration/create-issue.test.ts

# Run with coverage
bun test --coverage

# Run in watch mode
bun test --watch
```

---

## Best Practices

1. **Real API Testing**: Always test against real Plane API
2. **Test Isolation**: Each test creates its own data, cleans up after
3. **Descriptive Names**: Test names describe the behavior being tested
4. **Explicit Assertions**: Assert on specific values, not just existence
5. **Error Coverage**: Test both success and failure cases
6. **Documentation**: Document expected behaviors and edge cases

---

## Resources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [Plane API Reference](https://developers.plane.so/api-reference/introduction)
- [Plane Node SDK](https://github.com/makeplane/plane-node-sdk)
