# Conflict Report: `add-issue-label` / `remove-issue-label` Race Condition → Plane SDK

**Date**: March 10, 2026  
**SDK Version**: `@makeplane/plane-node-sdk` v0.2.8 (latest)  
**Severity**: ~~Medium~~ **Not applicable for papai** — see note below  
**Affects**: Both `add-issue-label` and `remove-issue-label` operations symmetrically

> **papai architecture note**: This race condition does **not apply** to papai. Each bot interaction maps to exactly one user, and the Vercel AI SDK's `generateText` executes tool calls sequentially in a single async chain — there is no concurrent label modification within a session. The analysis below is retained for completeness and for any future multi-instance or parallel-migration scenarios.

---

## 1. Problem Summary

### The Race Scenario

Both `add-issue-label` and `remove-issue-label` currently use a read-modify-write
pattern:

```typescript
// Step 1: Read current state
const workItem = await client.workItems.retrieve(workspaceSlug, projectId, workItemId, ['labels'])
const currentLabelIds = workItem.labels ?? [] // e.g. ['A', 'B']

// Step 2: Compute new state locally
const newLabels = [...currentLabelIds, labelId] // ['A', 'B', 'C']  ← add
// or
const newLabels = currentLabelIds.filter((id) => id !== labelId) // ['A']  ← remove

// Step 3: Write the full array back
await client.workItems.update(workspaceSlug, projectId, workItemId, { labels: newLabels })
```

If two concurrent requests interleave between **Step 1** and **Step 3**, one update
silently overwrites the other:

```
Time →  Bot A: read [A,B]         write [A,B,C]
        Bot B:         read [A,B]              write [A,B,D]
Result: [A,B,D]  ← C lost silently ✗
```

This is the classic **Lost Update Problem** (TOCTOU — Time of Check / Time of Use).

### Backend Confirmation (Django Source)

The race is not a SDK artifact — it reflects how the Plane Django backend implements
the update. From `apps/api/plane/api/serializers/issue.py` (confirmed in both the
`api` and `app` serializer variants):

```python
def update(self, instance, validated_data):
    labels = validated_data.pop("labels", None)   # or "label_ids"
    ...
    if labels is not None:
        IssueLabel.objects.filter(issue=instance).delete()    # DELETE ALL
        IssueLabel.objects.bulk_create([...], ...)            # INSERT ALL
```

The server performs a **destructive full-replace** at the database level — delete every
existing `IssueLabel` row for the issue, then bulk-insert the new set. There is no
server-side merge or atomic append. The race window exists entirely between the client's
`retrieve` and `update` calls.

---

## 2. API Verification

### 2a. Public REST API (`/api/v1/…`)

**Verdict: No atomic label endpoint. Full-replace only.**

The official Plane v1 REST API exposes exactly one endpoint for modifying a work item's
labels:

```
PATCH /api/v1/workspaces/{slug}/projects/{project_id}/work-items/{work_item_id}/
Body: { "labels": ["uuid1", "uuid2", ...] }
```

- The `labels` field is documented as `string[]` — a complete replacement array.
- There is no `$push`, `$pull`, JSON Merge Patch, or RFC 6902 JSON Patch support.
- No `POST /work-items/{id}/labels/` endpoint exists.
- No `DELETE /work-items/{id}/labels/{labelId}/` endpoint exists.
- No `If-Match` / ETag conditional request support is documented or implemented.

### 2b. Internal App API (`/api/workspaces/…/issue-labels/`)

The internal (non-public) app API exposes an `/issue-labels/` prefix — but this is for
managing **label definitions** (creating/patching/deleting label metadata objects), not
for assigning existing labels to individual work items:

```
POST   /api/workspaces/{slug}/projects/{pid}/issue-labels/         → create a label
GET    /api/workspaces/{slug}/projects/{pid}/issue-labels/{id}/    → retrieve label metadata
PATCH  /api/workspaces/{slug}/projects/{pid}/issue-labels/{id}/    → update label name/color
DELETE /api/workspaces/{slug}/projects/{pid}/issue-labels/{id}/    → delete the label itself
```

These operate on `Label` objects (the label catalogue), not on `IssueLabel` join-table
rows (the assignment relationship). There is no `BulkCreateIssueLabelsEndpoint` equivalent
for _assigning_ labels to a work item either — the `BulkCreateIssueLabelsEndpoint`
(`POST /bulk-create-labels/`) creates label definitions in bulk, not issue-label
assignments.

### 2c. Web App Pattern

The Plane web app itself uses the same full-replace model
(confirmed in `apps/web/core/components/issues/issue-detail/label/select/root.tsx`):

```typescript
const handleLabel = async (_labelIds: string[]) => {
  await labelOperations.updateIssue(workspaceSlug, projectId, issueId, { label_ids: _labelIds })
}
```

The web app avoids the race through browser-side optimistic UI updates and single-user
per-tab state — not through server-side atomicity. The `label_ids` sent is always the
full desired set computed from the current UI state.

### 2d. `updated_at` as Version Token

Work items include an `updated_at` timestamp in their response. However:

- Plane does not accept an `If-Match` or `updated_at` guard in `PATCH` requests.
- There is no `422 Unprocessable Entity` or `412 Precondition Failed` path in the update handler.
- The `updated_at` field cannot be leveraged for server-side conditional writes.

### Summary Table

| Mechanism                                                  | Available? | Notes                               |
| ---------------------------------------------------------- | ---------- | ----------------------------------- |
| Atomic append endpoint (`POST /issues/{id}/labels/`)       | ✗ No       | Does not exist in any Plane version |
| Atomic remove endpoint (`DELETE /issues/{id}/labels/{id}`) | ✗ No       | Does not exist                      |
| JSON Patch RFC 6902 (`PATCH` with `op: add/remove`)        | ✗ No       | Not supported                       |
| `$push` / `$pull` semantics                                | ✗ No       | Not supported                       |
| ETag / `If-Match` optimistic locking                       | ✗ No       | API does not emit or check ETags    |
| `updated_at` conditional guard                             | ✗ No       | Server ignores it on write          |
| Full-replace `PATCH labels: [...]`                         | ✓ Yes      | Only available mechanism            |

---

## 3. Concurrency Analysis

### Realistic Risk Assessment

The actual risk depends heavily on the deployment model:

| Scenario                                                    | Race Probability | Impact                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Single-user bot, single instance**                        | Negligible       | The LLM generates tool calls sequentially within one `generateText` session. Two label modifications to the same issue within the same response are serialized. Across separate user messages, the user would need to send two messages simultaneously — unlikely. |
| **Multi-user bot, single instance** (papai's current model) | Low              | Users would need to modify the same issue's labels concurrently. Possible but rare in practice.                                                                                                                                                                    |
| **Multi-user bot, multi-instance** (horizontal scale)       | Moderate         | Multiple Telegram webhook replicas process requests in parallel. If two users touch the same issue label simultaneously, a race is plausible.                                                                                                                      |
| **Automated import/migration**                              | High             | A bulk migration issuing parallel `add-issue-label` calls (e.g., applying labels from Linear to many issues) intentionally exploits parallelism — this is a real hazard.                                                                                           |

### Nature of Failure

When a race occurs:

- **For `add-issue-label`**: One of the two added labels is silently dropped. The work item loses a label without any error to either caller (both receive HTTP 200).
- **For `remove-issue-label`**: One label removal survives; the other's write may _restore_ a label the first writer intended to keep, or _re-delete_ a label the first writer intended to add.

Failures are **silent and non-retryable** — neither party receives an error, and the response looks successful.

---

## 4. Alternative Solutions

### Option 1: Accept the Race (Current Approach)

**What it is**: Document the limitation and accept that on extremely rare concurrent
label modifications to the same issue, one update may be silently lost.

**Pros**:

- Zero implementation complexity.
- Entirely correct for papai's primary use case (single-user or low-traffic multi-user, sequential LLM tool calls).
- The web app itself lives with this — Plane's own frontend has the same window.

**Cons**:

- Silent data loss with no error feedback.
- Unacceptable for automated migration workloads (parallel issue processing).
- Technically incorrect behaviour if the contract advertises atomicity.

**Verdict**: Acceptable for interactive single/multi-user bot. **Not acceptable** for bulk migration.

---

### Option 2: Application-Level Per-Issue Mutex

**What it is**: Maintain an in-process `Map<issueId, Promise>` that serializes all label
operations for a given issue. Each operation acquires the "lock" for that issue ID before
reading, and releases it after writing.

```typescript
// In-process serialization queue per issue ID
const issueQueues = new Map<string, Promise<void>>()

async function withIssueLock<T>(issueId: string, fn: () => Promise<T>): Promise<T> {
  const prev = issueQueues.get(issueId) ?? Promise.resolve()
  let resolve!: () => void
  const next = new Promise<void>(r => { resolve = r })
  issueQueues.set(issueId, next)
  try {
    await prev
    return await fn()
  } finally {
    resolve()
    if (issueQueues.get(issueId) === next) issueQueues.delete(issueId)
  }
}

// Usage:
async function addIssueLabelSafe(params: AddLabelParams): Promise<WorkItemResult> {
  return withIssueLock(params.workItemId, async () => {
    const workItem = await client.workItems.retrieve(...)
    const current = workItem.labels ?? []
    if ((current as string[]).includes(params.labelId)) return mapResult(workItem)
    return client.workItems.update(..., { labels: [...current, params.labelId] })
  })
}
```

**Pros**:

- Eliminates the race within a single process instance.
- Pure TypeScript — no infrastructure dependencies.
- Negligible overhead (Promise chaining, no I/O).
- Handles the idempotency guard (skip if label already present) for free.
- Directly applicable to the migration's parallel workloads.

**Cons**:

- **Does not work across multiple bot instances** (horizontal scale). Each process has its own `Map`.
- Locks accumulate if not cleaned up on error — the `finally` cleanup above handles the normal case; a leaked rejection would prevent future operations on that issue ID until the process restarts.

**Verdict**: **Best option for papai's single-instance deployment**. Fixes the vast majority of real-world races with minimal code.

---

### Option 3: Retry on Staleness via `updated_at` Comparison

**What it is**: Read the work item (capturing `updated_at`), compute the new state, write
the update, then re-read and verify the result. If `updated_at` has changed between our
read and write (indicating a concurrent modification), retry the whole operation up to
N times.

```typescript
async function addIssueLabelWithRetry(
  params: AddLabelParams,
  maxRetries = 3,
): Promise<WorkItemResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const workItem = await client.workItems.retrieve(...)
    const snapshotUpdatedAt = workItem.updated_at
    const current = workItem.labels as string[] ?? []

    if (current.includes(params.labelId)) return mapResult(workItem)

    const updated = await client.workItems.update(..., {
      labels: [...current, params.labelId],
    })

    // Verify: if updated_at advanced more than expected, a concurrent write may have
    // intervened. Re-read and check actual labels.
    const verified = await client.workItems.retrieve(...)
    const actualLabels = verified.labels as string[] ?? []

    if (actualLabels.includes(params.labelId)) return mapResult(verified)

    // Label missing after update — concurrent overwrite happened, retry
    const delay = 50 * 2 ** attempt
    await new Promise(r => setTimeout(r, delay))
  }
  throw new Error(`Failed to add label after ${maxRetries} retries`)
}
```

**Pros**:

- Works across multiple instances.
- No infrastructure dependencies.

**Cons**:

- **Not truly atomic**: The race window still exists between the write and the verification read — a third writer can interfere.
- Dramatically increases API call count (2–4× per operation) plus retry overhead.
- Fragile: detecting "was my write overwritten?" requires comparing the actual post-write state, not a version token — a false negative is possible if two writers happen to add the same label.
- Complexity is high relative to benefit.

**Verdict**: Poor fit. Adds network overhead without eliminating the race.

---

### Option 4: External Distributed Lock (Redis / DB Row Lock)

**What it is**: Acquire a distributed lock keyed on `{workspaceSlug}:{projectId}:{issueId}`
before read and release after write. Suitable for multi-instance deployments.

```typescript
// Conceptual — using a hypothetical RedisLock adapter
async function addIssueLabelDistributed(params: AddLabelParams): Promise<WorkItemResult> {
  const lockKey = `issue-label:${params.workItemId}`
  const lock = await redisLock.acquire(lockKey, { ttl: 5000 })
  try {
    const workItem = await client.workItems.retrieve(...)
    const current = workItem.labels as string[] ?? []
    if ((current).includes(params.labelId)) return mapResult(workItem)
    return await client.workItems.update(..., { labels: [...current, params.labelId] })
  } finally {
    await lock.release()
  }
}
```

**Pros**:

- True serialization across any number of bot instances.
- Lock TTL prevents deadlocks from crashed processes.

**Cons**:

- Requires Redis (or equivalent) as an infrastructure dependency — significant overhead for a Telegram bot.
- Adds latency per label operation.
- Lock contention, TTL tuning, and retry-on-lock-busy handling add operational complexity.
- Overkill for papai's current single-instance model.

**Verdict**: Appropriate only if papai scales to true horizontal multi-instance deployment.

---

### Option 5: Merge After Write (Post-Hoc Repair)

**What it is**: After writing, fetch the current state and apply a corrective update if
the desired label is missing (due to a lost write). Essentially a best-effort eventual
consistency loop capped at a small number of attempts.

**Pros**: Works across instances. No locking infrastructure.

**Cons**: Same fundamental problem as Option 3 — the read-after-write still has a race,
and each repair attempt can itself be overwritten. Doesn't reduce error rate; just
increases API call count. Not suitable for remove-issue-label (harder to detect intent
vs. concurrent adds).

**Verdict**: Inferior to Option 2. Not recommended.

---

### Option 6: Idempotency Guard Only (No Retry)

**What it is**: Before performing the write, check if the label is already present (for
add) or already absent (for remove). Skip the write if no change is needed. This doesn't
prevent the race but prevents no-op API calls and double-add/double-remove corruption.

```typescript
async function addIssueLabel(params: AddLabelParams): Promise<WorkItemResult> {
  const workItem = await client.workItems.retrieve(...)
  const current = workItem.labels as string[] ?? []
  if (current.includes(params.labelId)) {
    return mapResult(workItem)  // Already present, no-op
  }
  return client.workItems.update(..., { labels: [...current, params.labelId] })
}
```

**Pros**: Prevents redundant writes and self-races. Zero extra infrastructure.

**Cons**: Does not eliminate the concurrent-writer race.

**Verdict**: Should be included in any approach as a baseline guard, but not sufficient alone.

---

## 5. Recommended Approach

### For interactive bot usage (current papai model): **Option 2 + Option 6**

Combine the in-process per-issue mutex with the idempotency guard:

1. **Per-issue async queue** (Option 2) — serializes all label operations to the same
   issue within a single bot process. Eliminates the race for the current architecture.
2. **Idempotency guard** (Option 6) — inside the lock, check if the desired state already
   holds. Skip the write if no change is needed; avoid double-add or double-remove.

**Rationale**:

- papai currently runs as a single process handling multiple users.
- The LLM tool calls within one response are already sequential.
- The only real concurrent-label scenario is **two different users** modifying the same
  issue's labels at the same time — the mutex handles exactly this.
- No infrastructure change required.
- If papai is later scaled horizontally, the mutex can be replaced by a Redis lock without
  changing the surrounding code structure.

### For bulk migration workloads

Use Option 2 (per-issue mutex) applied within the migration runner to serialize all
label operations per issue. Since the migration runner is already serialized per-user
after the recent fix (sequential `for` loop), label operations for the same issue within
one user's migration are already serialized. Cross-user parallelism on the same issue
is addressed by the mutex.

---

## 6. Implementation Sketch

### Shared Issue Lock Utility

```typescript
// src/utils/issue-lock.ts

const issueQueues = new Map<string, Promise<void>>()

export async function withIssueLock<T>(issueId: string, fn: () => Promise<T>): Promise<T> {
  const prev = issueQueues.get(issueId) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((r) => {
    release = r
  })
  issueQueues.set(issueId, next)
  try {
    await prev
    return await fn()
  } finally {
    release()
    if (issueQueues.get(issueId) === next) {
      issueQueues.delete(issueId)
    }
  }
}
```

### `add-issue-label` with Lock + Idempotency Guard

```typescript
// src/huly/add-issue-label.ts  (sketch — actual implementation wraps withClient)

export async function addIssueLabel(params: AddIssueLabelParams): Promise<IssueResult> {
  return withIssueLock(params.workItemId, async () => {
    const workItem = await client.workItems.retrieve(workspaceSlug, projectId, params.workItemId, ['labels'])
    const current = (workItem.labels ?? []) as string[]

    // Idempotency guard: skip if already present
    if (current.includes(params.labelId)) {
      return mapWorkItemToResult(workItem)
    }

    const updated = await client.workItems.update(workspaceSlug, projectId, params.workItemId, {
      labels: [...current, params.labelId],
    })
    return mapWorkItemToResult(updated)
  })
}
```

### `remove-issue-label` with Lock + Idempotency Guard

```typescript
// src/huly/remove-issue-label.ts  (sketch)

export async function removeIssueLabel(params: RemoveIssueLabelParams): Promise<IssueResult> {
  return withIssueLock(params.workItemId, async () => {
    const workItem = await client.workItems.retrieve(workspaceSlug, projectId, params.workItemId, ['labels'])
    const current = (workItem.labels ?? []) as string[]

    // Idempotency guard: skip if already absent
    if (!current.includes(params.labelId)) {
      return mapWorkItemToResult(workItem)
    }

    const updated = await client.workItems.update(workspaceSlug, projectId, params.workItemId, {
      labels: current.filter((id) => id !== params.labelId),
    })
    return mapWorkItemToResult(updated)
  })
}
```

### Notes on the Mutex Implementation

- **Memory**: The `Map` only holds entries for issues actively being modified. The entry is deleted in `finally` once no further operations are queued. Under normal operation, the map stays small (O(concurrent operations)).
- **Error propagation**: If `fn()` throws, the `finally` block still runs — the release fires and the next queued operation proceeds normally. The error propagates to the caller.
- **No starvation**: Each `withIssueLock` call chains onto the previous promise for that issue ID. All callers make progress in order.
- **Horizontal scale**: If multiple bot instances are deployed, the `Map` exists per process. A distributed Redis lock would need to replace `withIssueLock` — the callers would not change.

---

## 7. `remove-issue-label` — Parallel Analysis

The remove operation is the symmetric case of add. All of the above analysis applies
identically:

| Property               | `add-issue-label`                  | `remove-issue-label`                                                 |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| Operation              | Append `labelId` to current array  | Filter out `labelId` from current array                              |
| Race type              | Lost Update (add silently dropped) | Lost Update (remove not applied, or remove reverts a concurrent add) |
| Idempotency guard      | Skip if already present            | Skip if already absent                                               |
| Lock strategy          | `withIssueLock` wraps both steps   | Same                                                                 |
| Backend behaviour      | `DELETE` all + `bulk_create`       | Same — server replaces all                                           |
| Atomic API alternative | None                               | None                                                                 |

The remove operation has one additional subtlety: if a race occurs between a concurrent
**add** and a **remove** for _different_ labels, the loser's write discards the winner's
change. For example:

```
Bot A: add C  →  reads [A,B],  writes [A,B,C]
Bot B: remove A  →  reads [A,B],  writes [B]         ← C lost silently
```

The mutex addresses this case equally — any two concurrent label operations (regardless
of whether they are adds or removes, and regardless of which label) are serialized per
issue ID.

---

## 8. References

- **Plane public API docs**: https://developers.plane.so/api-reference/issue/update-issue-detail
- **Django serializer source** (confirmed full-replace): `apps/api/plane/api/serializers/issue.py` lines 233–266
- **Internal app serializer**: `apps/api/plane/app/serializers/issue.py` lines 275–308
- **Web app label update** (confirms full-replace in UI): `apps/web/core/components/issues/issue-detail/label/select/root.tsx`
- **SDK `UpdateWorkItem` type** — `labels?: string[]` is full-replace; no patch semantics
- **No JSON Patch support**: RFC 6902 not referenced anywhere in Plane's API surface
- **No ETag support**: `If-Match` header is not accepted by any Plane endpoint
