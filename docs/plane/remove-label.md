# Mapping: `removeLabel` → Plane SDK

## Linear Implementation

**File**: `src/linear/remove-label.ts`

```typescript
removeLabel({ apiKey, labelId }):
  Promise<{ id: string; success: true }>
```

**Linear SDK call**:
```typescript
const client = new LinearClient({ apiKey })
await client.deleteIssueLabel(labelId)
// returns { id: labelId, success: true }
```

---

## Plane SDK Equivalent

**SDK method**: `client.labels.delete`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

await client.labels.delete(
  workspaceSlug,
  projectId,      // required in Plane; not needed in Linear
  labelId,
)

// Returns: void
```

---

## Key Differences

| Aspect | Linear | Plane |
|--------|--------|-------|
| Required params | `labelId` only | `workspaceSlug` + `projectId` + `labelId` |
| Return value | `{ id, success: true }` | `void` |
| SDK method | `client.deleteIssueLabel(labelId)` | `client.labels.delete(slug, projectId, labelId)` |

## Migration Notes

- Plane requires the `projectId` to delete a label, since labels are project-scoped. Store `projectId` alongside `labelId` when creating labels.
- The return is `void`; build `{ id: labelId, success: true }` in the caller for a consistent shape.
- Deleting a label that is actively assigned to work items: Plane may automatically remove the label from all work items, or it may leave orphaned references depending on the API version. Verify behavior in your environment.
- There is no soft-delete for labels in Plane; deletion is permanent.
