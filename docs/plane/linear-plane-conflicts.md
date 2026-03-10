Based on the mappings I documented, here are the ones requiring the most research, ranked by severity:

---

### Critical — API behavior is ambiguous or broken

**`update-issue-relation`**
No update method exists in Plane. The delete+recreate pattern is non-atomic: if `create` fails after `delete`, the relation is silently lost. Need to verify: does Plane's `relations.delete` remove _all_ relations between a pair, or only a specific type?

**`remove-issue-relation`**
Same uncertainty: the delete call takes `{ related_issue }` with no `relation_type` filter. If two work items have both `blocking` and `relates_to` relations, it's unclear whether one or both are deleted.

**`archive-issue`**
Plane's `UpdateWorkItem` type may not expose `archived_at` in the SDK's TypeScript interface (it's in the raw API but may be missing from the typed DTO). Needs verification against the installed SDK version.

---

### High — Structural mismatches requiring design decisions

**`archive-project` / `create-project` / `update-project` / `list-projects`**
The Linear Project → Plane Module mapping is an assumption. If the consuming code uses Linear "Projects" as top-level containers, it should map to Plane Projects instead. This is a one-time architectural decision that cascades across all four methods.

**`search-issues`**
Two Linear filter params have no Plane equivalent: `hasRelations`/`relationType` and `estimate`. Need to confirm whether `advancedSearch` supports these or if client-side post-filtering is the only option.

**`add-issue-label` / `remove-issue-label`**
The read-modify-write pattern is a race condition. Need to verify if Plane has an atomic `PATCH` endpoint for appending/removing a single label ID (e.g. via `$push`/`$pull` semantics) in its REST API that the SDK doesn't expose.

---

### Medium — Format conversions with runtime risk

**`create-issue` / `get-issue` / `update-issue`**
Markdown ↔ HTML conversion for `description`. A plain `<p>${body}</p>` wrap breaks for Markdown with lists, code blocks, bold, etc. Need a library decision (`marked`, `turndown`) and tests for round-trip fidelity.

**`get-issue`**
Relations are returned as a grouped object `{ blocking: string[], blocked_by: string[], ... }` — not a flat array with IDs. The mapping to Linear's `{ id, type, relatedIssueId, relatedIdentifier }[]` requires building synthetic IDs and loses the `relatedIdentifier` entirely unless a second lookup is done per related work item.

**`create-issue` / `update-issue`**
`estimate_point` is a string in Plane but must match the project's configured estimate scale (Fibonacci, t-shirt sizes, etc.). Passing an arbitrary number string will likely be rejected. Need to fetch valid values per project first.

---

### Lower — Cosmetic but worth noting

| Method                                          | Issue                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `add-issue-relation`                            | `issues` array in create — unclear if passing multiple IDs creates N relations or one multi-target relation |
| `get-issue-comments`                            | `created_by` is a user ID, not a display name — extra lookup needed                                         |
| `remove-issue-comment` / `update-issue-comment` | Require `workItemId` which Linear callers may not have stored                                               |
