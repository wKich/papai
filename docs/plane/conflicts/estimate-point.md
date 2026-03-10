# Conflict Analysis: `estimate_point` Mapping (Linear → Plane)

**Affects**: `create-issue`, `update-issue`  
**Severity**: Medium — runtime failure risk when estimate is non-null  
**Status**: Unresolved

---

## 1. Problem Summary

Linear stores estimates as plain **numbers** (story points, integers):

```typescript
// Linear
estimate?: number   // e.g. 1, 2, 3, 5, 8, 13
```

Plane's `estimate_point` field is typed as **`string`** in the Node SDK (`CreateWorkItem.estimate_point?: string`). The existing mapping in `create-issue.md` does a trivial string coercion:

```typescript
estimate_point: estimate !== undefined ? String(estimate) : undefined
```

This is almost certainly wrong. The **critical finding** from the official REST API docs is that `estimate_point` is documented as:

> `estimate_point` **integer or null** — Total estimate points for the work item takes value between (0, 7).

Despite the SDK typing it as `string`, the field is a **positional index (0–7)** into the project's configured estimate scale — not the actual estimate value label. Sending `String(5)` when the project has Fibonacci scale `[1, 2, 3, 5, 8]` and expecting it to match "5" is incorrect because the API expects `"3"` (index 3 → the 4th item = 5).

There is an additional complication: if a project has **no estimate system configured**, there are no valid index values at all, and any non-null `estimate_point` would be ignored or rejected.

---

## 2. Plane Estimate System

### 2.1 How `estimate_point` Works Internally

`estimate_point` is a zero-based integer index into the ordered list of estimate values the project admin has configured. The index range is 0–7 (maximum 8 values; free plan is capped at 6 values).

```
Project scale: ["1", "2", "3", "5", "8", "13"]
estimate_point:   0    1    2    3    4    5

Project scale: ["XS", "S", "M", "L", "XL"]
estimate_point:   0    1   2    3    4
```

Sending `estimate_point = "3"` on a Fibonacci project → Plane stores "5" (the value at index 3).  
Sending `estimate_point = "3"` on a T-shirt project → Plane stores "L" (the value at index 3).

### 2.2 Estimate Types

Each project may configure exactly one active estimate system (or none):

| Type                | Plane Presets                            | Example Values                |
| ------------------- | ---------------------------------------- | ----------------------------- |
| **Points / Linear** | Linear (1–N), Fibonacci, Squares, Custom | `1 2 3 4 5` or `1 2 3 5 8 13` |
| **Categories**      | T-shirt (XS/S/M/L/XL), Easy–Hard, Custom | `S M L`                       |
| **Time** (Pro only) | Hours preset, Custom                     | `1h 2h 3h 4h 5h 30m`          |

### 2.3 Linear Estimate Scales

Linear offers Exponential, Fibonacci, Linear, or T-shirt sizing. When T-shirt sizes are used for graph display, Linear internally maps them to Fibonacci values. The raw API returns numbers regardless of the team's display scale.

### 2.4 No Estimate System

If a project has no estimate system enabled (default for new projects), `estimate_point` on existing work items is `null`, and sending any non-null value is likely silently ignored or rejected at the API level.

---

## 3. SDK / API Verification

### 3.1 `client.estimates` in Plane Node SDK

**Finding**: The `@makeplane/plane-node-sdk` does **not** expose a dedicated `client.estimates` resource. Inspecting the SDK's documented methods across all resources shows no `estimates` client property.

### 3.2 REST API Endpoint for Project Estimates

Plane's REST API exposes estimate configuration via:

```
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/estimates/
```

This is a standard REST resource that returns the estimate systems associated with the project. The response includes the active estimate system with its ordered `points` array.

Example (inferred from Plane internals):

```json
{
  "results": [
    {
      "id": "uuid-of-estimate-system",
      "name": "Fibonacci",
      "type": "fibonacci",
      "points": [
        { "id": "pt-uuid-0", "key": 0, "value": "1" },
        { "id": "pt-uuid-1", "key": 1, "value": "2" },
        { "id": "pt-uuid-2", "key": 2, "value": "3" },
        { "id": "pt-uuid-3", "key": 3, "value": "5" },
        { "id": "pt-uuid-4", "key": 4, "value": "8" },
        { "id": "pt-uuid-5", "key": 5, "value": "13" }
      ]
    }
  ]
}
```

Since the SDK does not wrap this endpoint, it must be accessed via direct `fetch` with the same API key header (`X-API-Key`).

### 3.3 `client.projects.retrieveFeatures()`

The feature flags endpoint (`GET /projects/{id}/features`) returns booleans for enabled features: `cycles`, `modules`, `epics`, etc. It does **not** return the estimate scale configuration. This is not useful for estimate resolution.

### 3.4 Known API Bug (Resolved)

GitHub issue [#5213](https://github.com/makeplane/plane/issues/5213) filed in July 2024 reported that `estimate_point` returns `null` via the API even when set. This was resolved and closed 2026-01-02. The current API correctly returns the integer index.

---

## 4. Validation Behavior

Based on the API docs and the PR [#7460](https://github.com/makeplane/plane/pull/7460) ("added field validations in serializer", merged July 2025), Plane added explicit field validation to the work item serializer.

**Expected behavior**:

| Scenario                                             | Plane behavior                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `estimate_point: null` or field omitted              | Always accepted; clears the estimate                                 |
| `estimate_point: "3"` with a scale of 5+ values      | Accepted; stored as index 3                                          |
| `estimate_point: "8"` (> max index 7)                | Rejected with 400 validation error                                   |
| `estimate_point: "3"` when no estimate system active | Likely silently ignored or 400                                       |
| `estimate_point: "XL"` (non-numeric string)          | Rejected — the field expects an integer index as string, not a label |

**The existing `String(estimate)` coercion is incorrect**: passing `String(5)` from a Linear issue will store index 5 on the Plane project, mapping to the 6th configured value — which is almost certainly not "5 story points" unless the project happened to configure its estimate scale in a way that aligns.

---

## 5. Mapping Strategy

The core challenge: Linear stores the **actual value** (e.g. `5` = "5 story points"); Plane stores the **index** (e.g. `3` = "the 4th value in the scale"). Mapping requires knowing the project's scale.

### 5.1 Ideal Mapping Logic

```
1. Fetch project estimate scale (once, cache per project)
2. If no estimate system → omit estimate_point entirely
3. If numeric scale (Points type):
   a. Find exact match index: scale.findIndex(v => v === String(linearEstimate))
   b. If found → use that index
   c. If not found → nearest-value fallback or omit
4. If category scale (T-shirt etc.):
   a. No reliable numeric→category mapping → omit
5. Set estimate_point = String(index) or undefined
```

### 5.2 Linear Estimate Values Likely to Collide Well

When both Linear and Plane use Fibonacci, the values align: `1 2 3 5 8 13`. An exact-match lookup will succeed for all standard Linear Fibonacci values. This is the common case for teams migrating from Linear to Plane.

---

## 6. Alternative Solutions

### Option A — Omit Always (Current Safest Behavior)

**Approach**: Never set `estimate_point` during import. Estimates are migrated manually or in a follow-up pass.

|                      |                                                       |
| -------------------- | ----------------------------------------------------- |
| **Pros**             | Zero API errors; zero complexity; always safe         |
| **Cons**             | Estimate data is silently lost; no migration fidelity |
| **Recommended when** | Estimate fidelity is not required; one-way migration  |

---

### Option B — String Coercion Pass-through _(current — incorrect)_

**Approach**: `estimate_point: String(linearEstimate)` (already in create-issue.md).

|                      |                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------- |
| **Pros**             | Simple; works accidentally when Linear numeric value equals the Plane index                 |
| **Cons**             | Semantically wrong (value ≠ index); stores wrong estimate; produces incorrect data silently |
| **Recommended when** | Never — this is incorrect and should not be used                                            |

---

### Option C — Pre-fetch + Exact Match with Omit Fallback ⭐ **(Recommended)**

**Approach**: Fetch the project's estimate scale from `GET .../estimates/`. Parse the ordered values. For each issue, find the index of the Linear numeric value in the scale's values array. If no match, omit the field.

```typescript
// Pseudocode
const scale = await fetchProjectEstimateScale(workspaceSlug, projectId)
// scale = ["1", "2", "3", "5", "8", "13"] for Fibonacci

function mapEstimate(linearValue: number, scale: string[]): string | undefined {
  const idx = scale.indexOf(String(linearValue))
  return idx >= 0 ? String(idx) : undefined
}
```

|                      |                                                                        |
| -------------------- | ---------------------------------------------------------------------- |
| **Pros**             | Semantically correct; no wrong data; graceful fallback on mismatch     |
| **Cons**             | Extra HTTP call per project (mitigated by caching); slightly more code |
| **Recommended when** | Whenever estimate fidelity matters                                     |

---

### Option D — Pre-fetch + Nearest-Value Mapping

**Approach**: Like Option C, but instead of omitting on mismatch, finds the closest value in the scale.

```typescript
function nearestEstimateIndex(linearValue: number, scale: string[]): string | undefined {
  const numericScale = scale.map(Number).filter((n) => !isNaN(n))
  if (numericScale.length === 0) return undefined // category scale, skip
  const closest = numericScale.reduce((a, b) => (Math.abs(b - linearValue) < Math.abs(a - linearValue) ? b : a))
  const idx = numericScale.indexOf(closest)
  return String(idx)
}
```

|                      |                                                                               |
| -------------------- | ----------------------------------------------------------------------------- |
| **Pros**             | Preserves relative effort ordering even when values don't align exactly       |
| **Cons**             | "Nearest" may produce misleading data; 5 → `"4"` in some scales is surprising |
| **Recommended when** | Migration tool where approximate estimate is better than no estimate          |

---

### Option E — Estimate Type Detection + Selective Mapping

**Approach**: Fetch estimate scale; detect if it is numeric (Points type) or categorical (Category/Time). Only map for numeric scales; always omit for categorical scales.

```typescript
const isNumericScale = scale.every((v) => !isNaN(Number(v)))

if (!isNumericScale) return undefined // T-shirt, Easy-Hard → no mapping possible
// else proceed with exact match or nearest
```

|                      |                                                                           |
| -------------------- | ------------------------------------------------------------------------- |
| **Pros**             | Prevents nonsensical category mappings; explicit about what can be mapped |
| **Cons**             | Requires fetching scale anyway; minor additional logic                    |
| **Recommended when** | Projects may use mixed estimate types across different boards             |

---

### Option F — Cache Estimate Config Per Project

**Approach**: This is not a standalone solution but an optimization layer on top of Options C/D/E. Estimate scales rarely change; cache them for the duration of a migration run (or with a short TTL for a live bot).

```typescript
const estimateScaleCache = new Map<string, string[]>()

async function getEstimateScale(workspaceSlug: string, projectId: string): Promise<string[]> {
  const key = `${workspaceSlug}:${projectId}`
  const cached = estimateScaleCache.get(key)
  if (cached !== undefined) return cached

  const scale = await fetchProjectEstimateScale(workspaceSlug, projectId)
  estimateScaleCache.set(key, scale)
  return scale
}
```

|                      |                                                                         |
| -------------------- | ----------------------------------------------------------------------- |
| **Pros**             | Eliminates N+1 HTTP calls when creating many issues in the same project |
| **Cons**             | Not needed for low-volume use; adds a module-level mutable variable     |
| **Recommended when** | Bulk migration (many issues per project); always pair with C/D/E        |

---

## 7. Recommended Approach

**Option C (Pre-fetch + Exact Match with Omit Fallback) + Option F (Cache)**

Rationale:

1. **Correctness first**: The index semantics make string coercion wrong by design. Sending the wrong index silently stores incorrect estimate data on every issue.
2. **Exact match is reliable for the common case**: Teams migrating from Linear typically use Fibonacci on both sides. Exact match succeeds for all standard Fibonacci values with zero approximation error.
3. **Omit on mismatch is safe**: Better to have no estimate than a wrong estimate. The user can fill in estimates manually or in a post-migration pass.
4. **Caching is cheap**: One HTTP call per project, cached in a `Map<projectId, string[]>` for the lifetime of the operation.
5. **Detect numeric vs category scales**: Avoids nonsensical mappings when the Plane project uses T-shirt sizes.

---

## 8. Implementation Sketch

```typescript
// src/plane/estimate-mapper.ts

const estimateScaleCache = new Map<string, string[]>()

interface EstimatePoint {
  key: number
  value: string
}

interface EstimateSystem {
  id: string
  points: EstimatePoint[]
}

/**
 * Fetches the active estimate scale for a project.
 * Returns an ordered array of estimate value strings (e.g. ["1","2","3","5","8"]).
 * Returns [] if no estimate system is configured.
 */
async function fetchProjectEstimateScale(
  baseUrl: string,
  apiKey: string,
  workspaceSlug: string,
  projectId: string,
): Promise<string[]> {
  const resp = await fetch(`${baseUrl}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/estimates/`, {
    headers: { 'X-API-Key': apiKey },
  })
  if (!resp.ok) return []

  const data = (await resp.json()) as { results?: EstimateSystem[] }
  const system = data.results?.[0]
  if (system === undefined) return []

  // Sort by key (positional index) to get ordered value list
  return [...system.points].sort((a, b) => a.key - b.key).map((p) => p.value)
}

async function getEstimateScale(
  baseUrl: string,
  apiKey: string,
  workspaceSlug: string,
  projectId: string,
): Promise<string[]> {
  const cacheKey = `${workspaceSlug}:${projectId}`
  const cached = estimateScaleCache.get(cacheKey)
  if (cached !== undefined) return cached

  const scale = await fetchProjectEstimateScale(baseUrl, apiKey, workspaceSlug, projectId)
  estimateScaleCache.set(cacheKey, scale)
  return scale
}

/**
 * Maps a Linear numeric estimate to a Plane estimate_point index string.
 * Returns undefined if the value cannot be reliably mapped.
 */
export async function mapLinearEstimateToPlane(
  linearEstimate: number | undefined,
  baseUrl: string,
  apiKey: string,
  workspaceSlug: string,
  projectId: string,
): Promise<string | undefined> {
  if (linearEstimate === undefined) return undefined

  const scale = await getEstimateScale(baseUrl, apiKey, workspaceSlug, projectId)
  if (scale.length === 0) return undefined // no estimate system configured

  // Only attempt mapping for numeric scales (Points type)
  const isNumericScale = scale.every((v) => !isNaN(Number(v)))
  if (!isNumericScale) return undefined // T-shirt / category scale — no safe mapping

  const idx = scale.indexOf(String(linearEstimate))
  if (idx === -1) return undefined // value not in scale — omit rather than approximate

  return String(idx)
}

// Usage in create-issue / update-issue:
//
// const estimate_point = await mapLinearEstimateToPlane(
//   linearEstimate,
//   config.planeBaseUrl,
//   config.planeApiKey,
//   workspaceSlug,
//   projectId,
// )
//
// await client.workItems.create(workspaceSlug, projectId, {
//   name: title,
//   estimate_point,   // string index "0"–"7" or undefined
//   ...
// })
```

---

## 9. Cache Strategy

| Scenario                                        | Strategy                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bulk migration** (many issues per project)    | Module-level `Map<string, string[]>` initialized fresh per migration run. No TTL needed — estimate scales don't change during a migration.     |
| **Live bot** (interactive, one issue at a time) | Same `Map` but with a TTL: cache for 5–10 minutes (`Date.now() + ttlMs`). Invalidate on any API error suggesting configuration change.         |
| **Multi-project**                               | Key by `workspaceSlug:projectId` to avoid cross-project collisions.                                                                            |
| **Error resilience**                            | On fetch failure, return `[]` (→ omit estimate) rather than throwing. Log a warning. Do not cache errors — allow retry on next issue creation. |

Example with TTL:

```typescript
interface CacheEntry {
  scale: string[]
  expiresAt: number
}

const estimateScaleCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function getEstimateScale(/* ... */): Promise<string[]> {
  const cacheKey = `${workspaceSlug}:${projectId}`
  const entry = estimateScaleCache.get(cacheKey)
  if (entry !== undefined && entry.expiresAt > Date.now()) return entry.scale

  const scale = await fetchProjectEstimateScale(/* ... */)
  estimateScaleCache.set(cacheKey, { scale, expiresAt: Date.now() + CACHE_TTL_MS })
  return scale
}
```

---

## Summary of Key Findings

| Finding               | Detail                                                                        |
| --------------------- | ----------------------------------------------------------------------------- |
| `estimate_point` type | Integer index 0–7 (API doc: `integer or null`); SDK types it as `string`      |
| Meaning               | Positional index into ordered project estimate scale, **not** the value label |
| Current mapping       | `String(linearEstimate)` — **incorrect** — sends value as if it were an index |
| SDK estimate resource | **Not exposed** in `@makeplane/plane-node-sdk`; must use raw `fetch`          |
| REST endpoint         | `GET /api/v1/workspaces/{slug}/projects/{id}/estimates/`                      |
| Max values            | 8 (indices 0–7); free plan capped at 6                                        |
| Estimate types        | Points (numeric), Category (strings), Time (Pro)                              |
| No scale configured   | `estimate_point` should be omitted — no valid indices exist                   |
| T-shirt scales        | Cannot reliably map Linear numeric values → omit                              |
| Recommended approach  | Pre-fetch scale, exact-match index lookup, omit on miss, cache per project    |
