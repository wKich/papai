# Conflict: `remove-issue-comment` / `update-issue-comment` — `workItemId` Requirement

**Date**: 2026-03-10  
**Severity**: Medium (theoretical conflict; not a real issue in papai's LLM workflow)  
**APIs affected**: `update-issue-comment`, `remove-issue-comment`

---

## 1. Problem Summary

Linear's comment operations only need a `commentId`:

```typescript
// Linear — minimal surface
await client.updateComment(commentId, { body })
await client.deleteComment(commentId)
```

Plane requires the full ancestry path to locate any comment:

```typescript
// Plane — full path required
await client.workItems.comments.update(workspaceSlug, projectId, workItemId, commentId, data)
await client.workItems.comments.delete(workspaceSlug, projectId, workItemId, commentId)
```

A caller who only knows `commentId` cannot call either Plane operation without first resolving the parent `workItemId`. This creates an API surface mismatch when mapping Linear-style callers to Plane.

---

## 2. API Verification

### 2.1 Plane REST API — no comment-only endpoint exists

Every Plane comment endpoint uses the same hierarchical URL structure:

| Operation | Path                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------- |
| List      | `GET  /api/v1/workspaces/{slug}/projects/{projectId}/work-items/{workItemId}/comments/`               |
| Create    | `POST /api/v1/workspaces/{slug}/projects/{projectId}/work-items/{workItemId}/comments/`               |
| Retrieve  | `GET  /api/v1/workspaces/{slug}/projects/{projectId}/work-items/{workItemId}/comments/{commentId}/`   |
| Update    | `PATCH /api/v1/workspaces/{slug}/projects/{projectId}/work-items/{workItemId}/comments/{commentId}/`  |
| Delete    | `DELETE /api/v1/workspaces/{slug}/projects/{projectId}/work-items/{workItemId}/comments/{commentId}/` |

There is **no** workspace-level comment lookup (e.g. `GET /api/v1/workspaces/{slug}/comments/{commentId}/`). `workItemId`, `projectId`, and `workspaceSlug` are all mandatory at every comment endpoint. This was verified against the official Plane API reference (developers.plane.so) and the `@makeplane/plane-node-sdk` context7 documentation.

### 2.2 `WorkItemComment` contains the parent `issue` UUID

The comment object returned by Plane's list and retrieve endpoints includes:

```jsonc
{
  "id": "f3e29f26-...",
  "issue": "e1c25c66-...", // ← parent work item UUID, always present
  "project": "4af68566-...", // ← parent project UUID, always present
  "workspace": "cd4ab5a2-...",
  "comment_html": "...",
  "created_at": "2023-11-20T09:26:10Z",
}
```

This is the most actionable finding: **`issue` is embedded in every comment response**. Any implementation that returns raw comments to the caller can include `issueId` at zero extra API cost.

### 2.3 Plane Node SDK confirms the constraint

The official SDK (`@makeplane/plane-node-sdk`) exposes no shortcut. All comment methods require the full `(workspaceSlug, projectId, workItemId, commentId)` path. There is no `comments.findById(commentId)` or equivalent.

---

## 3. Context Analysis — Is This a Real Problem for papai?

**Short answer: No, not in practice.**

The LLM's natural conversation flow in papai is always:

```
1. User: "update the second comment on issue ABC-42"
2. LLM calls: get_issue_comments({ issueId: "ABC-42" })
   → receives [{ id: "c1", body: "...", issueId: "ABC-42" }, ...]
3. LLM calls: update_issue_comment({ commentId: "c1", issueId: "ABC-42", body: "..." })
```

The LLM **always** fetches comments via `get_issue_comments` first, which requires an `issueId`. After step 2, the LLM has both `commentId` and `issueId` in its context window. It will never credibly arrive at step 3 without step 2.

The only theoretical edge cases where `issueId` could be missing:

| Scenario                                                                                               | Likelihood                                  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| User pastes a raw `commentId` from a URL with no issue context                                         | Very low — papai has no deep-link ingestion |
| LLM hallucinates a `commentId` without calling `get_issue_comments` first                              | Possible, but results in a 404 regardless   |
| A future integration stores comment IDs externally (e.g. webhook, database) without storing the parent | Possible for future features                |

The current papai wrapper also doesn't surface `issueId` in `getIssueComments` responses — it strips it. This is the actual source of friction, not a fundamental API gap. The data is there; it is being discarded.

---

## 4. Alternative Solutions

### Solution A — Return `issueId` from `getIssueComments` (exploit embedded `issue` field)

The Plane comment response already contains `"issue": "<workItemId>"`. The wrapper simply passes it through to callers. No extra API calls needed.

**Pros**:

- Zero additional API calls
- Data is already present in every Plane comment response
- Callers always have enough context to proceed
- Composable — `update_issue_comment` and `remove_issue_comment` can require `issueId` as a normal parameter

**Cons**:

- Changes the `getIssueComments` return shape (additive, not breaking)
- Callers must store `issueId` alongside `commentId`

**Verdict**: ✅ Recommended.

---

### Solution B — Require `issueId` as an explicit parameter in the Plane wrappers

Change `updateIssueComment` and `removeIssueComment` to require `issueId` in their parameter object. Document it clearly. Callers are responsible for providing it.

```typescript
// Proposed signature
updateIssueComment({ apiKey, issueId, commentId, body }): Promise<...>
removeIssueComment({ apiKey, issueId, commentId }): Promise<...>
```

**Pros**:

- Most honest representation of Plane's actual API
- No indirection or extra state to manage
- Explicit is better than implicit

**Cons**:

- Deviates from Linear's API surface (Linear doesn't require `issueId`)
- Tool schema exposed to the LLM grows; LLM must always supply `issueId`
- The LLM already has `issueId` in context, but requiring it makes the tool harder to compose

**Verdict**: ✅ Acceptable as companion to Solution A. Can be the wire-level signature even if Solution A provides `issueId` automatically via `getIssueComments`.

---

### Solution C — Reverse lookup via `WorkItemComment.issue` field (lazy resolution at call time)

If a caller provides only `commentId`, resolve `issueId` by calling `comments.retrieve` with a wildcard search — but Plane offers no such endpoint. Instead, use `issue` from a cached previous `getIssueComments` call.

A practical variant: expose a `resolveCommentIssue(commentId)` helper that walks the in-memory conversation history to find which issue the comment belongs to.

**Pros**:

- Transparent to callers who only have `commentId`

**Cons**:

- Plane has no global comment-by-ID endpoint; this cannot be implemented as a pure API call
- History-based resolution is fragile and non-deterministic
- Requires conversation history coupling in the tool layer

**Verdict**: ❌ Not viable as a standalone solution. Only works as a fallback on top of Solution A.

---

### Solution D — Application-level storage (`commentId → issueId` in the database)

When `addIssueComment` succeeds, persist `(commentId, issueId)` to the bot's SQLite database. When `updateIssueComment` or `removeIssueComment` are called, look up `issueId` from the database.

**Pros**:

- Works even if the LLM never provides `issueId`

**Cons**:

- Adds a DB schema change and read/write path for a mismatch that doesn't actually occur in practice
- Does not cover comments that existed before the bot created them (i.e. all non-bot comments)
- Data can go stale if issues are moved between projects
- Over-engineered for the problem

**Verdict**: ❌ Over-engineered; not needed. Would only make sense for external-ID sync use cases.

---

### Solution E — Accept the gap; leave `issueId` undocumented as a requirement

Keep the current wrappers unchanged, add documentation noting that `issueId` must be supplied. Rely on the LLM's conversation context.

**Pros**:

- No code changes

**Cons**:

- Leaves the `getIssueComments` return shape incomplete (discards `issue` for no reason)
- Future callers have no guidance
- The inconsistency will resurface when writing Plane-adapter tests

**Verdict**: ❌ Acceptable only as a temporary state; not a long-term design.

---

## 5. Recommended Approach

**Implement Solutions A + B together:**

1. **Add `issueId` to the `getIssueComments` return type** — return `issue` from the Plane comment response. This is a zero-cost additive change that makes the downstream flow self-sufficient.

2. **Require `issueId` as an explicit parameter** in `updateIssueComment` and `removeIssueComment` wrappers — matching Plane's actual API requirements honestly.

The combination means:

- Callers get `issueId` automatically from `getIssueComments`
- The tool schemas are explicit and accurate
- No extra API calls, no database writes, no history coupling

---

## 6. Implementation Sketch

### 6.1 Update `getIssueComments` return type

```typescript
// src/plane/get-issue-comments.ts

export interface PlaneComment {
  id: string
  issueId: string // ← NEW: pass through WorkItemComment.issue
  body: string // HTML from comment_html
  createdAt: Date
}

export async function getIssueComments(
  client: PlaneClient,
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
): Promise<PlaneComment[]> {
  const response = await client.workItems.comments.list(workspaceSlug, projectId, workItemId)
  return response.results.map((c) => ({
    id: c.id,
    issueId: c.issue, // ← populated from Plane response — no extra call
    body: c.comment_html,
    createdAt: new Date(c.created_at),
  }))
}
```

### 6.2 Update `updateIssueComment` and `removeIssueComment` signatures

```typescript
// src/plane/update-issue-comment.ts

export async function updateIssueComment(
  client: PlaneClient,
  workspaceSlug: string,
  projectId: string,
  workItemId: string, // ← required explicitly
  commentId: string,
  body: string,
): Promise<{ id: string; body: string; url: string }> {
  const updated = await client.workItems.comments.update(workspaceSlug, projectId, workItemId, commentId, {
    comment_html: markdownToHtml(body),
  })
  return {
    id: updated.id,
    body: updated.comment_html,
    url: buildCommentUrl(workspaceSlug, projectId, workItemId, commentId),
  }
}

// src/plane/remove-issue-comment.ts

export async function removeIssueComment(
  client: PlaneClient,
  workspaceSlug: string,
  projectId: string,
  workItemId: string, // ← required explicitly
  commentId: string,
): Promise<{ id: string; success: true }> {
  await client.workItems.comments.delete(workspaceSlug, projectId, workItemId, commentId)
  return { id: commentId, success: true }
}
```

### 6.3 LLM tool schema change

The tool definitions exposed to the LLM should include `issueId` as a required field in `update_issue_comment` and `remove_issue_comment`:

```typescript
// tools/update-issue-comment.ts
const schema = z.object({
  commentId: z.string().describe('The comment ID to update'),
  issueId: z.string().describe('The ID of the work item that contains this comment'),
  body: z.string().describe('New comment text in Markdown'),
})
```

Because `get_issue_comments` now returns `issueId` alongside each `commentId`, the LLM will naturally have the required value from the preceding tool call.

---

## 7. Schema Change Summary

| Location                       | Before                      | After                                |
| ------------------------------ | --------------------------- | ------------------------------------ |
| `getIssueComments` return type | `{ id, body, createdAt }[]` | `{ id, issueId, body, createdAt }[]` |
| `updateIssueComment` params    | `{ commentId, body }`       | `{ commentId, issueId, body }`       |
| `removeIssueComment` params    | `{ commentId }`             | `{ commentId, issueId }`             |
| Tool schema for LLM            | `commentId` only            | `commentId` + `issueId` (required)   |

The change is additive on `getIssueComments` and makes the parameters of the mutation tools more explicit. No existing runtime behaviour changes; the `issueId` was always present in the Plane API response — it was just being discarded.

---

## 8. References

- [Plane API — Retrieve a work item comment](https://developers.plane.so/api-reference/issue-comment/get-issue-comment-detail) — confirms `workItemId` is required on all paths
- [Plane API — Delete a work item comment](https://developers.plane.so/api-reference/issue-comment/delete-issue-comment) — same constraint
- [Plane API — Comments object schema](https://developers.plane.so/api-reference/issue-comment/overview) — confirms `issue` UUID is always returned in comment responses
- [Plane Node SDK (`@makeplane/plane-node-sdk`)](https://context7.com/makeplane/plane-node-sdk) — no comment-by-ID shortcut exists in the SDK
- [docs/plane/get-issue-comments.md](../get-issue-comments.md) — current wrapper discards `issue` field
- [docs/plane/update-issue-comment.md](../update-issue-comment.md) — gap documented
- [docs/plane/remove-issue-comment.md](../remove-issue-comment.md) — gap documented
