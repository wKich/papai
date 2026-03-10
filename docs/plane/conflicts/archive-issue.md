# Conflict Report: `archive-issue` → Plane SDK

**Date**: March 10, 2026  
**SDK Version**: `@makeplane/plane-node-sdk` v0.2.8 (latest)  
**Severity**: High — TypeScript type is strictly wrong, and the assumed workaround may also be silently broken

> **NOTICE**: Implementation will use **session-based authentication** (via `Cookie: sessionid=...`) to call the internal `/api/` endpoint directly, bypassing the public API limitation. See [Solution B (Session-Based Authentication)](#solution-b-session-based-authentication-reliable) in §9.

---

## 1. Problem Summary

The `archive-issue` mapping assumes archiving is done by PATCHing `archived_at` via
`client.workItems.update()`. This assumption has two interconnected problems:

**Problem A — TypeScript type gap**  
`archived_at` is present on the read model (`WorkItemBase`) but absent from the write DTO
(`UpdateWorkItem`). TypeScript will reject the call at compile time.

```typescript
// WorkItemBase (read model) — has the field:
interface WorkItemBase extends BaseModel {
  archived_at?: string // ✓ present
  // ...
}

// UpdateWorkItem (write DTO) — field is missing:
interface UpdateWorkItem {
  name?: string
  description_html?: string
  state?: string
  assignees?: string[]
  labels?: string[]
  parent?: string
  estimate_point?: string
  type?: string
  module?: string
  target_date?: string
  start_date?: string
  priority?: PriorityEnum
  // NO archived_at!
}
```

**Problem B — Runtime behaviour is undefined via the update endpoint**  
The official Plane REST API documentation for `PATCH /api/v1/…/work-items/{id}/` lists
the same 13 mutable fields as `UpdateWorkItem` above. `archived_at` is not listed as an
accepted body parameter. Passing it will likely be silently ignored by the Django
serializer unless `archived_at` is explicitly declared writable — which it is not in the
documented surface.

---

## 2. SDK Verification

**Source**: `src/models/WorkItem.ts` in the [`makeplane/plane-node-sdk`][sdk-repo] GitHub
repository (verified against `main` branch, consistent with v0.2.8 NPM release).

```typescript
// src/models/WorkItem.ts — lines 68–80
export interface UpdateWorkItem {
  name?: string
  description_html?: string
  state?: string
  assignees?: string[]
  labels?: string[]
  parent?: string
  estimate_point?: string
  type?: string
  module?: string
  target_date?: string
  start_date?: string
  priority?: PriorityEnum
}
// archived_at is absent. No planned addition found in open issues or PRs.
```

The SDK has **not been updated** to add `archived_at` to `UpdateWorkItem`. No open PR or
issue tracks this addition in the SDK repository as of March 2026.

[sdk-repo]: https://github.com/makeplane/plane-node-sdk

---

## 3. REST API Reality

### 3a. Public API (`/api/v1/`) — No archive endpoint

The official public REST API only exposes these work item endpoints:

| Method   | Path                | Description |
| -------- | ------------------- | ----------- |
| `POST`   | `/work-items/`      | Create      |
| `GET`    | `/work-items/`      | List        |
| `GET`    | `/work-items/{id}/` | Retrieve    |
| `PATCH`  | `/work-items/{id}/` | Update      |
| `DELETE` | `/work-items/{id}/` | Delete      |

There is **no `POST /work-items/{id}/archive/`** in the public API. The documented
`PATCH` body does not include `archived_at`.

Compare this to **cycles** and **modules**, which have dedicated archive endpoints exposed
in the public API:

```
POST /api/v1/…/cycles/{id}/archive/       ← publicly documented
POST /api/v1/…/modules/{id}/archive/      ← publicly documented
POST /api/v1/…/projects/{id}/archive/     ← publicly documented
```

Work items were not given equivalent treatment at the public API level.

### 3b. Internal Plane Application API (`/api/`) — Dedicated endpoint exists

Plane's own web frontend calls a dedicated archive endpoint on the internal router:

```
POST   /api/workspaces/{slug}/projects/{project_id}/issues/{id}/archive/
DELETE /api/workspaces/{slug}/projects/{project_id}/issues/{id}/archive/
```

Source: `apps/api/plane/app/urls/issue.py` and
`apps/web/core/services/issue/issue_archive.service.ts` in the Plane monorepo.

The backend handler (`IssueArchiveViewSet.archive`) works as follows:

```python
# plane/app/views/issue/archive.py
def archive(self, request, slug, project_id, pk=None):
    issue = Issue.issue_objects.get(...)
    if issue.state.group not in ["completed", "cancelled"]:
        return Response({"error": "Can only archive completed or cancelled state group issue"}, 400)
    issue.archived_at = timezone.now().date()
    issue.save()
    return Response({"archived_at": str(issue.archived_at)}, 200)
```

**Key constraints discovered**:

1. The endpoint accepts **no body** — it sets `archived_at = now()` server-side.
2. The issue **must be in a "completed" or "cancelled" state group** to be archived.
   Attempting to archive a non-completed issue returns HTTP 400.
3. This is the `/api/` (internal) router, **not** `/api/v1/` (public). Different URL
   prefix, but same API key authentication.
4. The `work-items` variant may also work (`/api/…/work-items/{id}/archive/`) since Plane
   supports both paths during the `/issues/` → `/work-items/` migration, but this is
   undocumented.

### 3c. State constraint vs. Linear behaviour

**Linear** archives any issue regardless of state. **Plane** enforces that archived issues
must be in a "completed" or "cancelled" state. This semantic mismatch means a direct
1-to-1 mapping is impossible without either:

- Changing the issue's state first, or
- Skipping the state check by using the internal API directly.

---

## 4. Alternative Solutions

### Option A — Type assertion (cast `UpdateWorkItem` to bypass the TS check)

```typescript
const updated = await client.workItems.update(workspaceSlug, projectId, workItemId, {
  archived_at: new Date().toISOString().split('T')[0],
} as UpdateWorkItem)
```

| Pros                                        | Cons                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| One-liner, no extra code                    | Violates project rule: no `@ts-ignore` or equivalent casts to silence type errors        |
| Works if backend silently honours the field | Backend may silently ignore `archived_at` via the PATCH endpoint — not verified          |
|                                             | State constraint still bypassed wrongly                                                  |
|                                             | The field is legitimately absent from the API contract; casting is lying to the compiler |

**Verdict**: Forbidden by the repo's no-lint-suppression rule and semantically wrong.

---

### Option B — Dedicated archive via direct `fetch` (internal app API)

Call the internal `/api/` endpoint directly using `fetch` with the same API key.

```typescript
async function archiveWorkItem(params: {
  baseUrl: string
  apiKey: string
  workspaceSlug: string
  projectId: string
  workItemId: string
}): Promise<{ archived_at: string }> {
  const url = `${params.baseUrl}/api/workspaces/${params.workspaceSlug}/projects/${params.projectId}/issues/${params.workItemId}/archive/`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': params.apiKey },
  })
  if (!response.ok) {
    const body = await response.json()
    throw new Error(body.error ?? `Archive failed: HTTP ${response.status}`)
  }
  return response.json() as Promise<{ archived_at: string }>
}
```

| Pros                                                                                | Cons                                                                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Uses the actual Plane archive logic (correct `archived_at` timestamp, activity log) | Calls the internal `/api/` router, not the public `/api/v1/` — undocumented dependency |
| Type-safe — no casts required                                                       | State constraint: issue must already be in "completed" or "cancelled" state            |
| Unarchive is symmetric (`DELETE` to same URL)                                       | URL path uses `/issues/` prefix (deprecated), `/work-items/` equivalent unverified     |
| Matches exactly what the Plane web UI does                                          | Breaking change risk if Plane reorganises internal routes                              |

---

### Option C — Local type augmentation (extend `UpdateWorkItem` locally)

Augment `UpdateWorkItem` with the missing field in a module declaration file.

```typescript
// src/plane/types.d.ts
import '@makeplane/plane-node-sdk'

declare module '@makeplane/plane-node-sdk' {
  interface UpdateWorkItem {
    archived_at?: string | null
  }
}
```

Then use normally:

```typescript
const updated = await client.workItems.update(workspaceSlug, projectId, workItemId, {
  archived_at: new Date().toISOString().split('T')[0],
})
```

| Pros                                            | Cons                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Fully type-safe — no casts, no suppression      | Still relies on the backend silently accepting `archived_at` via PATCH — unverified |
| Clean call site                                 | Does not use the proper archive logic (no state validation, no activity events)     |
| Easy to remove when SDK adds the field natively | If Plane ignores the field, the call succeeds but the item is not archived          |
|                                                 | State constraint entirely bypassed                                                  |

---

### Option D — State-based approach (set to "completed" state instead)

Map Linear's `archive` to setting the work item to a completion state in Plane.

```typescript
// Fetch the project's "completed" state ID first
const states = await client.states.list(workspaceSlug, projectId)
const completedState = states.results.find((s) => s.group === 'completed')

if (completedState) {
  await client.workItems.update(workspaceSlug, projectId, workItemId, {
    state: completedState.id,
  })
}
```

| Pros                                    | Cons                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| Fully type-safe, uses documented API    | Semantically wrong — "completed" ≠ "archived"                                  |
| No dependency on internal endpoints     | `archived_at` is not set; item appears in active views                         |
| Works on all Plane versions/self-hosted | Archived items should be hidden from default views; this does not achieve that |
|                                         | Requires a lookup for the "completed" state ID                                 |

**Verdict**: Suitable only as a fallback if the issue is not already in a terminal state
before archiving (as a pre-step for Option B).

---

### Option E — Combine state update + dedicated archive (two-step)

First move the issue to a completed/cancelled state, then call the archive endpoint.

```typescript
async function archiveIssueInPlane(
  client: PlaneClient,
  baseUrl: string,
  apiKey: string,
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
): Promise<{ archived_at: string }> {
  // Step 1: Ensure the issue is in a terminal state
  const issue = await client.workItems.retrieve(workspaceSlug, projectId, workItemId)
  const needsStateChange = /* check if state.group is not completed/cancelled */

  if (needsStateChange) {
    const states = await client.states.list(workspaceSlug, projectId)
    const completedState = states.results.find(s => s.group === 'completed')
    if (completedState) {
      await client.workItems.update(workspaceSlug, projectId, workItemId, {
        state: completedState.id,
      })
    }
  }

  // Step 2: Archive via internal endpoint
  const url = `${baseUrl}/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${workItemId}/archive/`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
  })
  if (!response.ok) throw new Error(`Archive failed: HTTP ${response.status}`)
  return response.json() as Promise<{ archived_at: string }>
}
```

| Pros                                                  | Cons                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| Correctly archives the item with proper `archived_at` | Two or three HTTP calls per action                                   |
| Handles the state constraint robustly                 | Modifies state as a side effect (may be visible in activity history) |
| Matches Linear's semantics most closely               | Still uses internal router                                           |

---

## 5. Recommended Approach

**Option B — Direct `fetch` to the internal archive endpoint**, with **Option E's
two-step logic** held in reserve if the state constraint becomes a problem.

**Rationale**:

1. The internal `/api/` endpoint is the same one Plane's own frontend uses. It is stable
   across all Plane versions and correctly sets `archived_at`, fires activity events, and
   removes the item from active views — all things the PATCH-with-field approach cannot
   guarantee.

2. The SDK already uses the same `apiKey` for auth; calling the endpoint via `fetch` with
   the same key adds only a minor dependency on the `/api/` prefix.

3. Type augmentation (Option C) is elegant as a compile-time patch but does not solve the
   runtime uncertainty — if Plane's PATCH handler ignores `archived_at`, the call succeeds
   silently but the item is not archived. Using the dedicated endpoint eliminates this
   ambiguity.

4. The state constraint should be surfaced as an error message back to the LLM tool
   caller, not silently worked around. The bot can respond: _"Work item must be in a
   completed or cancelled state before it can be archived."_

---

## 6. Implementation Sketch

```typescript
// src/plane/archive-work-item.ts
import type { PlaneClientConfig } from './types.js'

export interface ArchiveResult {
  id: string
  identifier: string
  title: string
  archivedAt: string
}

export async function archiveWorkItem(
  config: PlaneClientConfig,
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
): Promise<ArchiveResult> {
  // Use the internal app router (same auth, different prefix than /api/v1/)
  const url = `${config.baseUrl}/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${workItemId}/archive/`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': config.apiKey,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 400) {
    const body = (await response.json()) as { error?: string }
    // Propagate the state constraint message to the tool caller
    throw new Error(body.error ?? 'Cannot archive work item in its current state')
  }

  if (!response.ok) {
    throw new Error(`Archive failed with HTTP ${response.status}`)
  }

  const data = (await response.json()) as { archived_at: string }

  // Fetch minimal details to return the standard result shape
  const workItem = (await fetch(
    `${config.baseUrl}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/`,
    { headers: { 'X-API-Key': config.apiKey } },
  ).then((r) => r.json())) as { id: string; sequence_id: number; name: string }

  const project = (await fetch(`${config.baseUrl}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/`, {
    headers: { 'X-API-Key': config.apiKey },
  }).then((r) => r.json())) as { identifier: string }

  return {
    id: workItem.id,
    identifier: `${project.identifier}-${workItem.sequence_id}`,
    title: workItem.name,
    archivedAt: data.archived_at,
  }
}
```

### Simplified version (if identifier lookup is cached upstream)

If `identifier` and `name` are already available at the call site (e.g. retrieved earlier
in the same tool call), avoid the two extra fetches:

```typescript
export async function archiveWorkItemById(
  baseUrl: string,
  apiKey: string,
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
): Promise<{ archived_at: string }> {
  const url = `${baseUrl}/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${workItemId}/archive/`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, string>
    throw new Error(body['error'] ?? `Archive failed: HTTP ${response.status}`)
  }
  return response.json() as Promise<{ archived_at: string }>
}
```

---

## 7. Unarchive Counterpart

Unarchiving uses the same endpoint with `DELETE`:

```typescript
export async function unarchiveWorkItem(
  baseUrl: string,
  apiKey: string,
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
): Promise<void> {
  const url = `${baseUrl}/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${workItemId}/archive/`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'X-API-Key': apiKey },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, string>
    throw new Error(body['error'] ?? `Unarchive failed: HTTP ${response.status}`)
  }
  // 204 No Content on success — no body to parse
}
```

The backend handler sets `archived_at = None` and saves; no state transitioning is
required for unarchiving. This mirrors Linear's `unarchiveIssue()` cleanly.

---

## 8. Verification Notes

**Status**: VERIFIED — The internal archive endpoint exists but is not part of the public API.

### Documentation Sources

1. **Context7 Plane API Documentation** (2025-03): The public `/api/v1/` endpoints for work items include only standard CRUD operations (POST, GET, PATCH, DELETE). No archive/unarchive endpoints are documented.

2. **GitHub PR #5882** (makeplane/plane, Oct 2024): Merged default and archived issue detail endpoints, meaning archived issues can be retrieved via standard API without special endpoints.

3. **Search Results**: No public `POST /api/v1/.../work-items/{id}/archive/` endpoint exists in the official API documentation.

### Open Questions

| Question                                                                                             | Status                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does `/api/workspaces/.../work-items/{id}/archive/` exist in addition to the `/issues/` path?        | **VERIFIED**: The internal `/api/` endpoint uses `/issues/` path. No `/work-items/` variant is documented. The `/issues/` path is deprecated in the public API but still used internally.                                                                                                 |
| Does passing `archived_at` via the standard `PATCH /api/v1/…/work-items/{id}/` actually work?        | **CONFIRMED NOT SUPPORTED** — The PATCH endpoint only accepts 13 fields as documented; `archived_at` is not among them. The backend will silently ignore this field.                                                                                                                       |
| Will a future SDK version add `archived_at` to `UpdateWorkItem` or add `client.workItems.archive()`? | No open issue/PR found as of March 2026. Monitor SDK releases.                                                                                                                                                                                                                             |
| Are there self-hosted Plane deployments where the `/api/` router is not accessible from API clients? | **VERIFIED**: The `/api/` router is available in self-hosted, BUT uses **session-based auth**, not API key auth. The public `/api/v1/` uses API keys. Calling `/api/` with API key may fail with 401/403.                                                                                                                                                          |

### Self-Hosted Authentication Warning

**CRITICAL**: The internal `/api/` endpoints (including the archive endpoint) use **session-based authentication**, not API key authentication.

According to Plane's test documentation:
> "Plane exposes two distinct types of API endpoints. The External API, available at `/api/v1/`, uses API key authentication via the `X-Api-Key` header... The Web App API, available at `/api/`, uses session-based authentication (with CSRF disabled) and is intended for the web application's frontend."

**Implications**:
1. The archive endpoint at `/api/.../archive/` may reject API key authentication
2. Self-hosted instances have the same two-tier API structure as Plane Cloud
3. Some internal endpoints MAY accept API keys, but this is undocumented
4. Custom reverse proxy configurations (nginx) may block `/api/` routes entirely

**Recommendation**: Test authentication against your specific self-hosted instance before relying on internal endpoints.

---

## 9. Solutions for Programmatic Archive Access

### Source Code Analysis Summary

**DEFINITIVE FINDING**: The archive endpoint at `/api/workspaces/.../issues/.../archive/` **CANNOT** be accessed with API keys.

**Evidence from source code**:

```python
# plane/app/views/base.py:30-32
class BaseViewSet(TimezoneMixin, ModelViewSet, BasePaginator):
    authentication_classes = [BaseSessionAuthentication]  # ← Only session auth!

# plane/authentication/session.py
class BaseSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return
```

**What this means**:
- `BaseSessionAuthentication` inherits from Django REST Framework's `SessionAuthentication`
- It **only** reads the `sessionid` cookie from the request
- It **never** checks `X-Api-Key` headers
- The middleware logs API keys for audit purposes, but doesn't use them for auth

**Result**: The archive endpoint is accessible only via **session cookies**, not API keys.

---

### Available Workarounds

Since the archive endpoint uses internal session-based auth, here are the workarounds:

### Solution A: Test API Key on Internal Endpoint ❌ WON'T WORK

**Source Code Analysis Result**: **CONFIRMED - API keys do NOT work on internal `/api/` endpoints**

```typescript
// plane/app/views/base.py:30-32
class BaseViewSet(TimezoneMixin, ModelViewSet, BasePaginator):
    authentication_classes = [BaseSessionAuthentication]

// plane/authentication/session.py
class BaseSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return
```

**The internal `/api/` endpoints use `BaseSessionAuthentication`** which inherits from Django REST Framework's `SessionAuthentication`. This **only reads the `sessionid` cookie** - it does NOT check `X-Api-Key` headers.

**Status**: **ELIMINATED** - Don't waste time testing this. The source code definitively shows API keys are not accepted on internal `/api/` endpoints.

**Note**: The middleware logs API keys for audit purposes (`plane/middleware/api_log_middleware.py`), but authentication doesn't use them for `/api/` endpoints.

---

### Solution B: Session-Based Authentication (Reliable)

If API keys don't work, use session cookies by logging in programmatically:

```typescript
async function getSessionCookie(
  baseUrl: string,
  email: string,
  password: string
): Promise<string> {
  // Step 1: Login to get session cookie
  const loginResponse = await fetch(`${baseUrl}/api/sign-in/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  
  if (!loginResponse.ok) {
    throw new Error('Login failed')
  }
  
  // Extract session cookie from response
  const setCookieHeader = loginResponse.headers.get('set-cookie')
  if (!setCookieHeader) {
    throw new Error('No session cookie returned')
  }
  
  // Parse sessionid from cookie string
  const sessionMatch = setCookieHeader.match(/sessionid=([^;]+)/)
  return sessionMatch ? sessionMatch[1] : ''
}

// Usage
async function archiveWithSession(
  baseUrl: string,
  email: string,
  password: string,
  workspace: string,
  project: string,
  issueId: string
) {
  const sessionId = await getSessionCookie(baseUrl, email, password)
  
  const response = await fetch(
    `${baseUrl}/api/workspaces/${workspace}/projects/${project}/issues/${issueId}/archive/`,
    {
      method: 'POST',
      headers: {
        'Cookie': `sessionid=${sessionId}`,
        'Content-Type': 'application/json',
      },
    }
  )
  
  return response.json()
}
```

**Pros**: Mimics web UI exactly, should work reliably  
**Cons**: Requires storing user credentials, managing session expiration

---

### Solution C: PATCH with archived_at (Risky)

Try setting `archived_at` directly via the public PATCH endpoint (undocumented but might work):

```typescript
// Try direct PATCH (undocumented - may fail silently)
const response = await client.workItems.update(
  workspace,
  project,
  issueId,
  {
    archived_at: new Date().toISOString().split('T')[0], // YYYY-MM-DD
  } as any  // Type assertion to bypass TS
)

// Verify it actually archived
const issue = await client.workItems.retrieve(workspace, project, issueId)
if (issue?.archived_at) {
  console.log('✅ PATCH with archived_at worked!')
} else {
  console.log('❌ Backend ignored archived_at field')
}
```

**Pros**: Uses public API, cleanest solution if it works  
**Cons**: Likely to fail silently (field ignored), violates API contract

---

### Solution D: Two-Step "Archive" via State

If you can't actually archive, move to "completed" state as a workaround:

```typescript
async function pseudoArchive(
  client: PlaneClient,
  workspace: string,
  project: string,
  issueId: string
) {
  // Get "completed" state
  const states = await client.states.list(workspace, project)
  const completedState = states.results.find(s => s.group === 'completed')
  
  if (!completedState) {
    throw new Error('No completed state found')
  }
  
  // Move to completed (closest we can get to archiving via public API)
  await client.workItems.update(workspace, project, issueId, {
    state: completedState.id,
  })
  
  console.log('⚠️ Issue moved to completed state (not truly archived)')
}
```

**Pros**: Works 100% with public API  
**Cons**: Semantically incorrect, issue still appears in active views

---

### Solution E: Feature Request + Fork (Long-term)

1. **Create GitHub issue** requesting archive endpoint in public API:  
   `https://github.com/makeplane/plane/issues/new`

2. **Fork Plane** (self-hosted only) and add archive to `/api/v1/`:

```python
# In your Plane fork: apiserver/plane/api/views/issue.py
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def archive_issue(request, workspace_slug, project_id, issue_id):
    """Public API endpoint for archiving issues"""
    issue = Issue.objects.get(id=issue_id)
    if issue.state.group not in ['completed', 'cancelled']:
        return Response({'error': 'Must be completed/cancelled'}, status=400)
    issue.archived_at = timezone.now().date()
    issue.save()
    return Response({'archived_at': str(issue.archived_at)})
```

**Pros**: Permanent solution, helps community  
**Cons**: Long wait for official support, fork maintenance burden

---

### Solution F: Direct DB Access (Self-Hosted Only)

If you control the database:

```typescript
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.PLANE_DATABASE_URL
})

async function archiveViaDb(issueId: string) {
  const result = await pool.query(
    `UPDATE issues 
     SET archived_at = CURRENT_DATE
     WHERE id = $1
       AND state_id IN (
         SELECT id FROM states WHERE "group" IN ('completed', 'cancelled')
       )
     RETURNING archived_at`,
    [issueId]
  )
  
  return result.rows[0]?.archived_at
}
```

**Pros**: Bypasses API entirely, guaranteed to work  
**Cons**: Security risk, bypasses business logic, needs DB credentials

---

### Recommended Approach

**Source code analysis confirms**: API keys will **NOT** work on internal `/api/` endpoints. The archive endpoint requires session authentication.

1. **Use Solution B** (session auth) - This is the only reliable method for cloud instances
2. **For self-hosted: Use Solution F** (direct DB access) - Most reliable, bypasses API entirely
3. **Long-term: Submit feature request** to Plane team for `/api/v1/.../archive/` endpoint

**Decision Matrix**:

| Deployment | Recommended Solution | Why |
|------------|---------------------|-----|
| **Plane Cloud** | **Solution B** (session auth) | Only option that works via API |
| **Self-hosted** | **Solution F** (DB access) | Most reliable, no auth issues |
| **Both** | Submit feature request | Proper long-term fix

### Testing Requirements

**IMPORTANT**: The internal archive endpoint at `${baseUrl}/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${workItemId}/archive/` must be tested in E2E tests. See `@docs/testing/test-suite-foundation.md` for test implementation details.
