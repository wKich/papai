# Huly SDK Root Cause Analysis

## Background

After migrating from Linear to Huly, `src/huly/` accumulated 393 lint errors
(360 `no-unsafe-type-assertion`, 33 others). All stem from three core anti-patterns.

---

## Anti-Pattern 1: `Parameters<typeof client.X>` workaround

```typescript
// WRONG
type FindOneParams = Parameters<typeof client.findOne>
const result: unknown = await client.findOne(tracker.class.Issue, { _id: issueId } as FindOneParams[1])
const issue = result as Issue
```

**Why it happens:** fear of type errors on query objects.

**Why it is wrong:** `tracker.class.Issue` is `Ref<Class<Issue>>`. The method signature is:

```typescript
findOne<T extends Doc>(_class: Ref<Class<T>>, query: DocumentQuery<T>, ...): Promise<WithLookup<T> | undefined>
```

TypeScript infers `T = Issue` automatically. Result is already `WithLookup<Issue> | undefined`.

**Fix:**

```typescript
const issue = await client.findOne(tracker.class.Issue, { _id: issueId as Ref<Issue> })
// issue: WithLookup<Issue> | undefined — no casts needed
```

---

## Anti-Pattern 2: `result: unknown` + `as Type` round-trip

Direct consequence of #1. Annotating results as `unknown` forces unsafe casts downstream.
Eliminated entirely by using proper generics.

---

## Anti-Pattern 3: `Record<string, unknown>` for updates

```typescript
// WRONG
const updates: Record<string, unknown> = {}
updates['status'] = statusRef
await client.updateDoc(..., updates as UpdateDocParams[3])
```

**Fix:**

```typescript
import { type DocumentUpdate } from '@hcengineering/core'
import { type Issue } from '@hcengineering/tracker'

const update: DocumentUpdate<Issue> = {}
if (statusRef !== undefined) update.status = statusRef // type-checked
await client.updateDoc(tracker.class.Issue, core.space.Space as Ref<Space>, issueId as Ref<Issue>, update)
```

`DocumentUpdate<T>` = `Partial<Data<T>> & PushOptions<T> & IncOptions<T> & ...` — includes `$inc`.

---

## SDK Type Reference (confirmed from node_modules)

```typescript
// @hcengineering/api-client/src/types.ts
findOne<T extends Doc>(
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  options?: FindOptions<T>
): Promise<WithLookup<T> | undefined>

findAll<T extends Doc>(
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  options?: FindOptions<T>
): Promise<FindResult<T>>   // = WithLookup<T>[] & { total: number }

updateDoc<T extends Doc>(
  _class: Ref<Class<T>>,
  space: Ref<Space>,
  objectId: Ref<T>,
  operations: DocumentUpdate<T>,  // includes $inc, $push, $unset
  retrieve?: boolean
): Promise<TxResult>   // TxResult = {} — EMPTY, cannot read .object from it

addCollection<T extends Doc, P extends AttachedDoc>(
  _class: Ref<Class<P>>,
  space: Ref<Space>,
  attachedTo: Ref<T>,
  attachedToClass: Ref<Class<T>>,
  collection: Extract<keyof T, string> | string,
  attributes: AttachedData<P>,   // = Omit<P, keyof AttachedDoc>
  id?: Ref<P>
): Promise<Ref<P>>
```

Key facts:

- `core.space.Space` is `Ref<TypedSpace>` — cast to `Ref<Space>` is needed and acceptable
- `TxResult = {}` — never try to read `.object.sequence` from it
- `DocumentUpdate<T>` includes `IncOptions<T>` so `{ $inc: { sequence: 1 } }` is valid
- `Ref<T> = string & { __ref: T }` — user strings need `as Ref<T>` at API boundaries

---

## Acceptable Casts (do not trigger no-unsafe-type-assertion)

```typescript
issueId as Ref<Issue> // string → branded ID at boundary
projectId as Ref<Project> // string → branded ID at boundary
labelId as Ref<TagElement> // string → branded ID at boundary
core.space.Space as Ref<Space> // Ref<TypedSpace> → Ref<Space> (subtype)
```

These are the **only** casts that should remain after cleanup.

---

## Pattern: $inc + sequence

`TxResult = {}` — reading `.object.sequence` is always undefined at runtime.

```typescript
// CORRECT pattern after $inc
await client.updateDoc(
  tracker.class.Project,
  core.space.Space as Ref<Space>,
  projectId as Ref<Project>,
  { $inc: { sequence: 1 } },
  false,
)
const updated = await client.findOne(tracker.class.Project, { _id: projectId as Ref<Project> })
if (updated === undefined) throw new Error('Project not found after sequence increment')
const sequence = updated.sequence
```

---

## Zod Schema Mismatches (cause safeParse to fail silently)

| Field                | Current Schema                                     | Actual SDK Type                                        |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `Issue.description`  | `z.union([z.string(), z.undefined(), z.object()])` | `MarkupBlobRef \| null` → runtime `string \| null`     |
| `Doc.createdBy`      | `RefSchema` (required)                             | `PersonId` — optional (`?`) in Doc                     |
| `TagElement.color`   | `z.union([z.number(), z.string()])`                | `number` only                                          |
| `TagReference.color` | `z.union([z.number(), z.string()])`                | `number` only                                          |
| All schemas          | no `.passthrough()`                                | `WithLookup<T>` adds `$lookup`, `$source` extra fields |

**Fix:** add `.passthrough()` to all schemas to allow extra fields from `WithLookup<T>`.

---

## addCollection Attributes

`AttachedData<TagReference>` = `Omit<TagReference, keyof AttachedDoc>` = `{ tag: Ref<TagElement>; title: string; color: number; weight?: ... }`

```typescript
// CORRECT
await client.addCollection(
  tags.class.TagReference,
  projectId as Ref<Space>,
  issueId as Ref<Issue>,
  tracker.class.Issue,
  'labels',
  { tag: labelId as Ref<TagElement>, title: '', color: 0 },
)
```

---

## Contact/Person Lookup

`@hcengineering/contact` is not a direct dependency but is a transitive one.

```typescript
// Option A: add @hcengineering/contact to package.json dependencies
import contact, { type Person } from '@hcengineering/contact'
const person = await client.findOne(contact.class.Person, { _id: assigneeId as Ref<Person> })

// Option B: explicit generic with string class
const person = await client.findOne<Person>('contact:class:Person' as Ref<Class<Person>>, {
  _id: assigneeId as Ref<Person>,
})
```
