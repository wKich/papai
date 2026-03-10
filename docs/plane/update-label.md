# Mapping: `updateLabel` → Plane SDK

## Linear Implementation

**File**: `src/linear/update-label.ts`

```typescript
updateLabel({ apiKey, labelId, name, description, color }):
  Promise<{ id: string; name: string; color: string }>
```

**Linear SDK call**:
```typescript
const client = new LinearClient({ apiKey })
const payload = await client.updateIssueLabel(labelId, { name, description, color })
const label = await payload.issueLabel
// returns { id, name, color }
```

**Validation**: Throws if none of `name`, `description`, `color` are provided.

---

## Plane SDK Equivalent

**SDK method**: `client.labels.update`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

if (name === undefined && description === undefined && color === undefined) {
  throw new Error('At least one field must be provided to update a label')
}

const updated = await client.labels.update(
  workspaceSlug,
  projectId,      // required in Plane, not in Linear
  labelId,
  {
    name,
    description,
    color,
  }
)

// Returns Label { id, name, color, description, project, workspace, ... }
```

---

## Key Differences

| Aspect | Linear | Plane |
|--------|--------|-------|
| Required params | `labelId` + at least one of `name/description/color` | Also requires `workspaceSlug` + `projectId` |
| SDK call | `client.updateIssueLabel(labelId, data)` | `client.labels.update(slug, projectId, labelId, data)` |
| Return value | `{ id, name, color }` | Full `Label` object (includes `description`, `parent`, etc.) |
| Description | Supported | Supported |
| Parent | Not supported | Can update `parent` label ID |

## Migration Notes

- Plane requires `projectId` to update a label. Ensure it is stored alongside the `labelId`.
- The same at-least-one-field validation applies; maintain this guard before calling the SDK.
- Plane's return type includes additional fields (`description`, `parent`, `sort_order`) not present in Linear's return.
- `color` should be a hex string (e.g. `'#FF0000'`). Plane does not validate the format strictly, but normalize for consistency.
- The `description` field exists in both APIs, though Linear's create doesn't expose it via the wrapper — it can be set/cleared here.
