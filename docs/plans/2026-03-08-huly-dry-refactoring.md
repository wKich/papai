# Huly Code DRY Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate repetitive patterns across 22 src/huly/ operation files by extracting shared utilities, reducing code duplication by ~60%.

**Architecture:** Extract common patterns into focused utility modules: client lifecycle wrapper, entity fetchers, URL builder, priority mapper, color converter. Keep operation files lean by composing these utilities. Maintain functional style - pure functions, immutable data, no classes.

**Tech Stack:** TypeScript 5.x, Bun runtime, @hcengineering packages (core, tracker, tags), pino logger

---

## Prerequisites

- Read and understand CLAUDE.md for project context
- Familiar with functional-typescript skill (immutability, pure functions, Result types)
- Tests located in `tests/huly/` mirror `src/huly/` structure
- Run `bun test` to verify tests pass before starting
- All changes must pass `bun run lint`

---

## Task 1: Create HulyClient Type Alias

**Files:**

- Create: `src/huly/types.ts`
- Modify: `src/huly/create-issue.ts:65`, `src/huly/update-issue.ts:85`, `src/huly/search-issues.ts` (no explicit type), `src/huly/get-issue.ts:69`, `src/huly/add-issue-relation.ts:30`, `src/huly/add-issue-label.ts:27`, `src/huly/remove-issue-label.ts`, `src/huly/update-issue-relation.ts`, `src/huly/remove-issue-relation.ts`, `src/huly/get-issue-comments.ts`, `src/huly/update-issue-comment.ts`, `src/huly/remove-issue-comment.ts`
- Test: `tests/huly/types.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/huly/types.test.ts
import { describe, expect, it } from 'bun:test'
import type { HulyClient } from '../../src/huly/types.js'

describe('HulyClient type', () => {
  it('should be importable as a type', () => {
    // Type-only test - if this compiles, the type is valid
    const checkType = (_client: HulyClient) => {
      // no-op
    }
    expect(typeof checkType).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/huly/types.test.ts
```

Expected: FAIL - "Cannot find module '../../src/huly/types.js'"

**Step 3: Create the types module**

```typescript
// src/huly/types.ts
import type { getHulyClient } from './huly-client.js'

/**
 * Type alias for the Huly PlatformClient returned by getHulyClient
 * Used across all operation files to avoid repeating this type
 */
export type HulyClient = Awaited<ReturnType<typeof getHulyClient>>
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/huly/types.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/huly/types.test.ts src/huly/types.ts
git commit -m "feat(huly): add shared HulyClient type alias"
```

---

## Task 2: Replace Inline Type Definitions in create-issue.ts

**Files:**

- Modify: `src/huly/create-issue.ts:65`
- Test: `tests/huly/create-issue.test.ts` (existing tests should still pass)

**Step 1: Verify existing tests pass**

```bash
bun test tests/huly/create-issue.test.ts
```

Expected: PASS (all existing tests)

**Step 2: Replace inline type with import**

```typescript
// src/huly/create-issue.ts
// Add to imports:
import type { HulyClient } from './types.js'

// Remove line 65:
// type HulyClient = Awaited<ReturnType<typeof getHulyClient>>
```

**Step 3: Run tests to verify no regression**

```bash
bun test tests/huly/create-issue.test.ts
```

Expected: PASS

**Step 4: Run linter**

```bash
bun run lint
```

Expected: No errors

**Step 5: Commit**

```bash
git add src/huly/create-issue.ts
git commit -m "refactor(huly): use shared HulyClient type in create-issue"
```

---

## Task 3: Replace Inline Type Definitions in update-issue.ts

**Files:**

- Modify: `src/huly/update-issue.ts:85`
- Test: `tests/huly/update-issue.test.ts` (existing)

**Step 1: Verify existing tests pass**

```bash
bun test tests/huly/update-issue.test.ts
```

Expected: PASS

**Step 2: Replace inline type with import**

```typescript
// src/huly/update-issue.ts
// Add to imports:
import type { HulyClient } from './types.js'

// Remove line 85:
// type HulyClient = Awaited<ReturnType<typeof getHulyClient>>

// Also update line 25 and 57 parameter types:
// Change: client: Awaited<ReturnType<typeof getHulyClient>>
// To: client: HulyClient
```

**Step 3: Run tests**

```bash
bun test tests/huly/update-issue.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/huly/update-issue.ts
git commit -m "refactor(huly): use shared HulyClient type in update-issue"
```

---

## Task 4: Replace Inline Type Definitions in get-issue.ts

**Files:**

- Modify: `src/huly/get-issue.ts:69`
- Test: `tests/huly/get-issue.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/get-issue.test.ts
```

Expected: PASS

**Step 2: Replace inline type**

```typescript
// src/huly/get-issue.ts
// Add to imports:
import type { HulyClient } from './types.js'

// Remove line 69:
// type HulyClient = Awaited<ReturnType<typeof getHulyClient>>
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/get-issue.test.ts
bun run lint
git add src/huly/get-issue.ts
git commit -m "refactor(huly): use shared HulyClient type in get-issue"
```

---

## Task 5: Replace Inline Type Definitions in Remaining Files

**Files:**

- Modify: `src/huly/add-issue-relation.ts:30`, `src/huly/add-issue-label.ts:27`, `src/huly/remove-issue-label.ts`, `src/huly/update-issue-relation.ts`, `src/huly/remove-issue-relation.ts`, `src/huly/get-issue-comments.ts`, `src/huly/update-issue-comment.ts`, `src/huly/remove-issue-comment.ts`

**Step 1: Update add-issue-relation.ts**

```typescript
// src/huly/add-issue-relation.ts
// Add import:
import type { HulyClient } from './types.js'

// Remove: type HulyClient = Awaited<ReturnType<typeof getHulyClient>>
```

**Step 2: Update add-issue-label.ts**

```typescript
// src/huly/add-issue-label.ts
// Add import:
import type { HulyClient } from './types.js'

// Change line 27:
// from: client: Awaited<ReturnType<typeof getHulyClient>>
// to: client: HulyClient
```

**Step 3: Update remaining files similarly**

Apply the same pattern to:

- remove-issue-label.ts
- update-issue-relation.ts
- remove-issue-relation.ts
- get-issue-comments.ts
- update-issue-comment.ts
- remove-issue-comment.ts

**Step 4: Run all huly tests**

```bash
bun test tests/huly/
```

Expected: PASS

**Step 5: Commit all changes together**

```bash
git add src/huly/
git commit -m "refactor(huly): use shared HulyClient type across all operation files"
```

---

## Task 6: Create Priority Mapping Utilities

**Files:**

- Create: `src/huly/utils/priority.ts`
- Test: `tests/huly/utils/priority.test.ts`

**Step 1: Write failing tests**

```typescript
// tests/huly/utils/priority.test.ts
import { describe, expect, it } from 'bun:test'
import { mapLinearPriorityToHuly, mapHulyPriorityToLinear } from '../../../src/huly/utils/priority.js'

describe('priority mapping', () => {
  describe('mapLinearPriorityToHuly', () => {
    it('should map Linear 0 to Huly NoPriority', () => {
      expect(mapLinearPriorityToHuly(0)).toBe(0) // NoPriority
    })

    it('should map Linear 1 to Huly Urgent', () => {
      expect(mapLinearPriorityToHuly(1)).toBe(4) // Urgent
    })

    it('should map Linear 2 to Huly High', () => {
      expect(mapLinearPriorityToHuly(2)).toBe(3) // High
    })

    it('should map Linear 3 to Huly Medium', () => {
      expect(mapLinearPriorityToHuly(3)).toBe(2) // Medium
    })

    it('should map Linear 4 to Huly Low', () => {
      expect(mapLinearPriorityToHuly(4)).toBe(1) // Low
    })

    it('should return NoPriority for undefined', () => {
      expect(mapLinearPriorityToHuly(undefined)).toBe(0)
    })

    it('should return NoPriority for unknown values', () => {
      expect(mapLinearPriorityToHuly(999)).toBe(0)
    })
  })

  describe('mapHulyPriorityToLinear', () => {
    it('should map Huly NoPriority to Linear 0', () => {
      expect(mapHulyPriorityToLinear(0)).toBe(0)
    })

    it('should map Huly Low to Linear 4', () => {
      expect(mapHulyPriorityToLinear(1)).toBe(4)
    })

    it('should map Huly Medium to Linear 3', () => {
      expect(mapHulyPriorityToLinear(2)).toBe(3)
    })

    it('should map Huly High to Linear 2', () => {
      expect(mapHulyPriorityToLinear(3)).toBe(2)
    })

    it('should map Huly Urgent to Linear 1', () => {
      expect(mapHulyPriorityToLinear(4)).toBe(1)
    })

    it('should return 0 for unknown values', () => {
      expect(mapHulyPriorityToLinear(999)).toBe(0)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/huly/utils/priority.test.ts
```

Expected: FAIL - module not found

**Step 3: Create priority mapping utilities**

```typescript
// src/huly/utils/priority.ts
import { IssuePriority } from '@hcengineering/tracker'

/**
 * Maps Linear priority values to Huly IssuePriority enum
 * Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
 * Huly: NoPriority=0, Low=1, Medium=2, High=3, Urgent=4
 */
export function mapLinearPriorityToHuly(linearPriority: number | undefined): IssuePriority {
  switch (linearPriority) {
    case 0:
      return IssuePriority.NoPriority
    case 1:
      return IssuePriority.Urgent
    case 2:
      return IssuePriority.High
    case 3:
      return IssuePriority.Medium
    case 4:
      return IssuePriority.Low
    default:
      return IssuePriority.NoPriority
  }
}

/**
 * Maps Huly priority values to Linear priority scale
 * Huly: NoPriority=0, Low=1, Medium=2, High=3, Urgent=4
 * Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
 */
export function mapHulyPriorityToLinear(hulyPriority: number): number {
  const priorityMap: Record<number, number> = {
    0: 0, // NoPriority -> No priority
    4: 1, // Urgent -> Urgent
    3: 2, // High -> High
    2: 3, // Medium -> Medium
    1: 4, // Low -> Low
  }
  return priorityMap[hulyPriority] ?? 0
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/huly/utils/priority.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/huly/utils/priority.test.ts src/huly/utils/priority.ts
git commit -m "feat(huly): add shared priority mapping utilities"
```

---

## Task 7: Replace Priority Mapping in create-issue.ts

**Files:**

- Modify: `src/huly/create-issue.ts:45-63`
- Test: `tests/huly/create-issue.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/create-issue.test.ts
```

**Step 2: Replace local function with import**

```typescript
// src/huly/create-issue.ts
// Add to imports:
import { mapLinearPriorityToHuly } from './utils/priority.js'

// Remove lines 45-63 (the entire mapPriority function)
// Update line 155 in buildIssueData:
// from: priority: mapPriority(priority),
// to: priority: mapLinearPriorityToHuly(priority),
```

**Step 3: Run tests**

```bash
bun test tests/huly/create-issue.test.ts
bun run lint
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/huly/create-issue.ts
git commit -m "refactor(huly): use shared priority mapper in create-issue"
```

---

## Task 8: Replace Priority Mapping in search-issues.ts

**Files:**

- Modify: `src/huly/search-issues.ts:33-45`, `src/huly/search-issues.ts:102`
- Test: `tests/huly/search-issues.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/search-issues.test.ts
```

**Step 2: Replace local function with import**

```typescript
// src/huly/search-issues.ts
// Add to imports:
import { mapHulyPriorityToLinear } from './utils/priority.js'

// Remove lines 33-45 (the entire mapPriorityToNumber function)
// Update line 102:
// from: priority: mapPriorityToNumber(issue.priority),
// to: priority: mapHulyPriorityToLinear(issue.priority),
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/search-issues.test.ts
bun run lint
git add src/huly/search-issues.ts
git commit -m "refactor(huly): use shared priority mapper in search-issues"
```

---

## Task 9: Replace Priority Mapping in get-issue.ts

**Files:**

- Modify: `src/huly/get-issue.ts:45-67`, `src/huly/get-issue.ts:188`
- Test: `tests/huly/get-issue.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/get-issue.test.ts
```

**Step 2: Replace local function with import**

```typescript
// src/huly/get-issue.ts
// Add to imports:
import { mapHulyPriorityToLinear } from './utils/priority.js'

// Remove lines 45-67 (the entire mapPriorityToNumber function)
// Update line 188:
// from: priority: mapPriorityToNumber(issue.priority as number),
// to: priority: mapHulyPriorityToLinear(issue.priority as number),
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/get-issue.test.ts
bun run lint
git add src/huly/get-issue.ts
git commit -m "refactor(huly): use shared priority mapper in get-issue"
```

---

## Task 10: Create Color Conversion Utility

**Files:**

- Create: `src/huly/utils/color.ts`
- Test: `tests/huly/utils/color.test.ts`

**Step 1: Write failing tests**

```typescript
// tests/huly/utils/color.test.ts
import { describe, expect, it } from 'bun:test'
import { numberToHexColor } from '../../../src/huly/utils/color.js'

describe('numberToHexColor', () => {
  it('should convert number to hex color', () => {
    expect(numberToHexColor(0)).toBe('#000000')
    expect(numberToHexColor(255)).toBe('#0000ff')
    expect(numberToHexColor(16777215)).toBe('#ffffff')
    expect(numberToHexColor(16711680)).toBe('#ff0000')
  })

  it('should return hex string as-is if already hex', () => {
    expect(numberToHexColor('#ff0000')).toBe('#ff0000')
    expect(numberToHexColor('#00ff00')).toBe('#00ff00')
  })

  it('should return default black for undefined', () => {
    expect(numberToHexColor(undefined)).toBe('#000000')
  })

  it('should return default black for null', () => {
    expect(numberToHexColor(null)).toBe('#000000')
  })

  it('should return default black for invalid strings', () => {
    expect(numberToHexColor('not-a-color')).toBe('#000000')
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/huly/utils/color.test.ts
```

Expected: FAIL

**Step 3: Create color utility**

```typescript
// src/huly/utils/color.ts

/**
 * Converts a color value to hex format
 * Handles numeric colors (converts to hex) and hex strings (passes through)
 * Returns '#000000' as default for invalid inputs
 */
export function numberToHexColor(color: unknown): string {
  if (typeof color === 'number') {
    return `#${color.toString(16).padStart(6, '0')}`
  }
  if (typeof color === 'string' && color.startsWith('#')) {
    return color
  }
  return '#000000'
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/huly/utils/color.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/huly/utils/color.test.ts src/huly/utils/color.ts
git commit -m "feat(huly): add shared color conversion utility"
```

---

## Task 11: Replace Color Conversion in list-labels.ts

**Files:**

- Modify: `src/huly/list-labels.ts:43-51`, `src/huly/list-labels.ts:30`
- Test: `tests/huly/list-labels.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/list-labels.test.ts
```

**Step 2: Replace local function with import**

```typescript
// src/huly/list-labels.ts
// Add to imports:
import { numberToHexColor } from './utils/color.js'

// Remove lines 43-51 (the entire numberToHexColor function)
// Line 30 stays the same - it already uses numberToHexColor
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/list-labels.test.ts
bun run lint
git add src/huly/list-labels.ts
git commit -m "refactor(huly): use shared color utility in list-labels"
```

---

## Task 12: Replace Color Conversion in create-label.ts

**Files:**

- Modify: `src/huly/create-label.ts:68-76`, `src/huly/create-label.ts:58`
- Test: `tests/huly/create-label.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/create-label.test.ts
```

**Step 2: Replace local function with import**

```typescript
// src/huly/create-label.ts
// Add to imports:
import { numberToHexColor } from './utils/color.js'

// Remove lines 68-76 (the entire numberToHexColor function)
// Line 58 stays the same - it already uses numberToHexColor
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/create-label.test.ts
bun run lint
git add src/huly/create-label.ts
git commit -m "refactor(huly): use shared color utility in create-label"
```

---

## Task 13: Replace Color Conversion in update-label.ts

**Files:**

- Modify: `src/huly/update-label.ts` (check for formatColor function)
- Test: `tests/huly/update-label.test.ts` (existing)

**Step 1: Read update-label.ts to find color function**

```bash
head -100 src/huly/update-label.ts
```

**Step 2: If there's a duplicate color function, replace it**

```typescript
// src/huly/update-label.ts
// Add to imports:
import { numberToHexColor } from './utils/color.js'

// Remove any local color conversion function
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/update-label.test.ts
bun run lint
git add src/huly/update-label.ts
git commit -m "refactor(huly): use shared color utility in update-label"
```

---

## Task 14: Create Entity Fetcher Utilities

**Files:**

- Create: `src/huly/utils/fetchers.ts`
- Test: `tests/huly/utils/fetchers.test.ts`

**Step 1: Analyze fetch patterns from existing files**

From the code review, we need fetchers for:

- Issue (with not-found error)
- Project (with not-found error)
- Label/TagElement (with not-found error)

**Step 2: Write failing tests**

```typescript
// tests/huly/utils/fetchers.test.ts
import { describe, expect, it, jest } from 'bun:test'
import { fetchIssue, fetchProject } from '../../../src/huly/utils/fetchers.js'
import type { HulyClient } from '../../../src/huly/types.js'
import type { Issue, Project } from '@hcengineering/tracker'

describe('entity fetchers', () => {
  const createMockClient = (returnValue: unknown) =>
    ({
      findOne: jest.fn().mockResolvedValue(returnValue),
    }) as unknown as HulyClient

  describe('fetchIssue', () => {
    it('should return issue when found', async () => {
      const mockIssue = { _id: 'issue-123', identifier: 'TEST-1', title: 'Test Issue' } as Issue
      const client = createMockClient(mockIssue)

      const result = await fetchIssue(client, 'issue-123')
      expect(result).toBe(mockIssue)
    })

    it('should throw error when issue not found', async () => {
      const client = createMockClient(null)

      await expect(fetchIssue(client, 'issue-123')).rejects.toThrow('Issue not found: issue-123')
    })
  })

  describe('fetchProject', () => {
    it('should return project when found', async () => {
      const mockProject = { _id: 'proj-123', identifier: 'TEST', name: 'Test Project' } as Project
      const client = createMockClient(mockProject)

      const result = await fetchProject(client, 'proj-123')
      expect(result).toBe(mockProject)
    })

    it('should throw error when project not found', async () => {
      const client = createMockClient(undefined)

      await expect(fetchProject(client, 'proj-123')).rejects.toThrow('Project not found: proj-123')
    })
  })
})
```

**Step 3: Run tests to verify they fail**

```bash
bun test tests/huly/utils/fetchers.test.ts
```

Expected: FAIL

**Step 4: Create fetcher utilities**

```typescript
// src/huly/utils/fetchers.ts
import type { Ref } from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'
import type { HulyClient } from '../types.js'

/**
 * Fetches an issue by ID, throwing if not found
 */
export async function fetchIssue(client: HulyClient, issueId: string): Promise<Issue> {
  const issue = await client.findOne(tracker.class.Issue, { _id: issueId as Ref<Issue> })

  if (issue === undefined || issue === null) {
    throw new Error(`Issue not found: ${issueId}`)
  }
  return issue
}

/**
 * Fetches a project by ID, throwing if not found
 */
export async function fetchProject(client: HulyClient, projectId: string): Promise<Project> {
  const project = await client.findOne(tracker.class.Project, { _id: projectId as Ref<Project> })

  if (project === undefined || project === null) {
    throw new Error(`Project not found: ${projectId}`)
  }
  return project
}

/**
 * Fetches a label/tag element by ID, throwing if not found
 */
export async function fetchLabel(client: HulyClient, labelId: string): Promise<TagElement> {
  const label = await client.findOne(tags.class.TagElement, { _id: labelId as Ref<TagElement> })

  if (label === undefined || label === null) {
    throw new Error(`Label not found: ${labelId}`)
  }
  return label
}
```

**Step 5: Run tests to verify they pass**

```bash
bun test tests/huly/utils/fetchers.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add tests/huly/utils/fetchers.test.ts src/huly/utils/fetchers.ts
git commit -m "feat(huly): add shared entity fetcher utilities"
```

---

## Task 15: Replace Issue Fetcher in update-issue.ts

**Files:**

- Modify: `src/huly/update-issue.ts:87-95`, `src/huly/update-issue.ts:145`
- Test: `tests/huly/update-issue.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/update-issue.test.ts
```

**Step 2: Replace local function with import**

```typescript
// src/huly/update-issue.ts
// Add to imports:
import { fetchIssue } from './utils/fetchers.js'

// Remove lines 87-95 (the entire fetchIssue function)
// Line 145: change from fetchIssue(client, issueId) to fetchIssue(client, issueId)
// (same function name, just using imported version now)
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/update-issue.test.ts
bun run lint
git add src/huly/update-issue.ts
git commit -m "refactor(huly): use shared fetcher in update-issue"
```

---

## Task 16: Replace Issue Fetcher in get-issue.ts

**Files:**

- Modify: `src/huly/get-issue.ts:161-167`, `src/huly/get-issue.ts:162`
- Test: `tests/huly/get-issue.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/get-issue.test.ts
```

**Step 2: Replace inline fetch with utility**

```typescript
// src/huly/get-issue.ts
// Add to imports:
import { fetchIssue } from './utils/fetchers.js'

// In fetchIssueData function (lines 161-167), replace:
// const issue = await client.findOne(tracker.class.Issue, { _id: issueId as Ref<Issue> })
// if (issue === undefined || issue === null) {
//   throw new Error(`Issue not found: ${issueId}`)
// }
// with:
// const issue = await fetchIssue(client, issueId)
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/get-issue.test.ts
bun run lint
git add src/huly/get-issue.ts
git commit -m "refactor(huly): use shared fetcher in get-issue"
```

---

## Task 17: Replace Fetchers in add-issue-label.ts

**Files:**

- Modify: `src/huly/add-issue-label.ts:27-35`, `src/huly/add-issue-label.ts:77`
- Test: `tests/huly/add-issue-label.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/add-issue-label.test.ts
```

**Step 2: Replace local findIssue with shared fetcher**

```typescript
// src/huly/add-issue-label.ts
// Add to imports:
import { fetchIssue } from './utils/fetchers.js'

// Remove the findIssue function (lines 27-35)
// Update line 77:
// from: const issue = await findIssue(client, issueId)
// to: const issue = await fetchIssue(client, issueId)
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/add-issue-label.test.ts
bun run lint
git add src/huly/add-issue-label.ts
git commit -m "refactor(huly): use shared fetcher in add-issue-label"
```

---

## Task 18: Create URL Builder Utility

**Files:**

- Create: `src/huly/utils/url-builder.ts`
- Test: `tests/huly/utils/url-builder.test.ts`

**Step 1: Write failing tests**

```typescript
// tests/huly/utils/url-builder.test.ts
import { describe, expect, it, jest } from 'bun:test'
import { buildIssueUrl, buildIssueUrlByIdentifier } from '../../../src/huly/utils/url-builder.js'
import type { HulyClient } from '../../../src/huly/types.js'
import type { Issue, Project } from '@hcengineering/tracker'

describe('url builder', () => {
  describe('buildIssueUrl', () => {
    it('should build URL when project is found', async () => {
      const mockProject = { identifier: 'TEST' } as Project
      const client = {
        findOne: jest.fn().mockResolvedValue(mockProject),
      } as unknown as HulyClient

      const issue = { identifier: 'TEST-1', space: 'proj-123' } as Issue
      const url = await buildIssueUrl(client, issue)

      expect(url).toBe('https://huly.app/workbench/workspace/tracker/TEST/TEST-1')
    })

    it('should build URL with UNK when project not found', async () => {
      const client = {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as HulyClient

      const issue = { identifier: 'TEST-1', space: 'proj-123' } as Issue
      const url = await buildIssueUrl(client, issue)

      expect(url).toBe('https://huly.app/workbench/workspace/tracker/UNK/TEST-1')
    })
  })

  describe('buildIssueUrlByIdentifier', () => {
    it('should build URL from identifiers', () => {
      const url = buildIssueUrlByIdentifier('TEST', 'TEST-1')
      expect(url).toBe('https://huly.app/workbench/workspace/tracker/TEST/TEST-1')
    })
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/huly/utils/url-builder.test.ts
```

Expected: FAIL

**Step 3: Create URL builder utility**

```typescript
// src/huly/utils/url-builder.ts
import type { Ref } from '@hcengineering/core'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'
import { hulyUrl, hulyWorkspace } from '../env.js'
import type { HulyClient } from '../types.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'huly:url-builder' })

/**
 * Builds a URL for an issue, looking up the project identifier
 * Falls back to 'UNK' if project cannot be determined
 */
export async function buildIssueUrl(client: HulyClient, issue: Issue): Promise<string> {
  const project = await client.findOne(tracker.class.Project, { _id: issue.space as Ref<Project> })

  if (project !== undefined && project !== null && 'identifier' in project) {
    return buildIssueUrlByIdentifier((project as Project).identifier, issue.identifier)
  }

  log.warn({ space: issue.space }, 'Failed to find Project for URL building')
  return buildIssueUrlByIdentifier('UNK', issue.identifier)
}

/**
 * Builds a URL from known project and issue identifiers
 * Pure function - no async/client needed
 */
export function buildIssueUrlByIdentifier(projectIdentifier: string, issueIdentifier: string): string {
  return `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${projectIdentifier}/${issueIdentifier}`
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/huly/utils/url-builder.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/huly/utils/url-builder.test.ts src/huly/utils/url-builder.ts
git commit -m "feat(huly): add shared URL builder utilities"
```

---

## Task 19: Replace URL Building in add-issue-label.ts

**Files:**

- Modify: `src/huly/add-issue-label.ts:56-64`, `src/huly/add-issue-label.ts:79`
- Test: `tests/huly/add-issue-label.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/add-issue-label.test.ts
```

**Step 2: Replace local function with import**

```typescript
// src/huly/add-issue-label.ts
// Add to imports:
import { buildIssueUrl } from './utils/url-builder.js'

// Remove lines 56-64 (the entire buildIssueUrl function)
// Line 79 stays the same - it already calls buildIssueUrl
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/add-issue-label.test.ts
bun run lint
git add src/huly/add-issue-label.ts
git commit -m "refactor(huly): use shared URL builder in add-issue-label"
```

---

## Task 20: Replace URL Building in get-issue.ts

**Files:**

- Modify: `src/huly/get-issue.ts:149-159`, `src/huly/get-issue.ts:176`
- Test: `tests/huly/get-issue.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/get-issue.test.ts
```

**Step 2: Replace local function with import**

```typescript
// src/huly/get-issue.ts
// Add to imports:
import { buildIssueUrl } from './utils/url-builder.js'

// Remove lines 149-159 (the entire buildIssueUrl function)
// Line 176 stays the same - it already calls buildIssueUrl
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/get-issue.test.ts
bun run lint
git add src/huly/get-issue.ts
git commit -m "refactor(huly): use shared URL builder in get-issue"
```

---

## Task 21: Replace URL Building in search-issues.ts

**Files:**

- Modify: `src/huly/search-issues.ts:97-105`, `src/huly/search-issues.ts:103`
- Test: `tests/huly/search-issues.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/search-issues.test.ts
```

**Step 2: Replace inline URL building with utility**

```typescript
// src/huly/search-issues.ts
// Add to imports:
import { buildIssueUrlByIdentifier } from './utils/url-builder.js'

// Update mapToIssueResult function (lines 97-105):
// Change line 103:
// from: url: `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${projectIdentifier}/${issue.identifier}`,
// to: url: buildIssueUrlByIdentifier(projectIdentifier, issue.identifier),
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/search-issues.test.ts
bun run lint
git add src/huly/search-issues.ts
git commit -m "refactor(huly): use shared URL builder in search-issues"
```

---

## Task 22: Create Client Lifecycle Wrapper

**Files:**

- Create: `src/huly/utils/with-client.ts`
- Test: `tests/huly/utils/with-client.test.ts`

**Step 1: Write failing tests**

```typescript
// tests/huly/utils/with-client.test.ts
import { describe, expect, it, jest } from 'bun:test'
import { withClient } from '../../../src/huly/utils/with-client.js'
import type { HulyClient } from '../../../src/huly/types.js'

describe('withClient', () => {
  it('should call operation and close client on success', async () => {
    const mockClient = {
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as HulyClient

    const mockGetClient = jest.fn().mockResolvedValue(mockClient)
    const mockOperation = jest.fn().mockResolvedValue('result')

    const result = await withClient(123, mockGetClient, mockOperation)

    expect(mockGetClient).toHaveBeenCalledWith(123)
    expect(mockOperation).toHaveBeenCalledWith(mockClient)
    expect(mockClient.close).toHaveBeenCalled()
    expect(result).toBe('result')
  })

  it('should close client even when operation throws', async () => {
    const mockClient = {
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as HulyClient

    const mockGetClient = jest.fn().mockResolvedValue(mockClient)
    const mockOperation = jest.fn().mockRejectedValue(new Error('Operation failed'))

    await expect(withClient(123, mockGetClient, mockOperation)).rejects.toThrow('Operation failed')
    expect(mockClient.close).toHaveBeenCalled()
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/huly/utils/with-client.test.ts
```

Expected: FAIL

**Step 3: Create withClient utility**

```typescript
// src/huly/utils/with-client.ts
import { classifyHulyError } from '../classify-error.js'
import type { getHulyClient } from '../huly-client.js'
import type { HulyClient } from '../types.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'huly:with-client' })

/**
 * Higher-order function that manages Huly client lifecycle
 * - Gets client for user
 * - Executes operation
 * - Ensures client is closed in finally block
 * - Catches and classifies errors
 */
export async function withClient<T>(
  userId: number,
  getClient: typeof getHulyClient,
  operation: (client: HulyClient) => Promise<T>,
): Promise<T> {
  const client = await getClient(userId)

  try {
    return await operation(client)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId }, 'Operation failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/huly/utils/with-client.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/huly/utils/with-client.test.ts src/huly/utils/with-client.ts
git commit -m "feat(huly): add shared client lifecycle wrapper"
```

---

## Task 23: Apply withClient to Simple Operation File

**Files:**

- Modify: `src/huly/list-labels.ts` (simplest file - only 51 lines)
- Test: `tests/huly/list-labels.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/list-labels.test.ts
```

**Step 2: Refactor to use withClient**

```typescript
// src/huly/list-labels.ts
// Add to imports:
import { withClient } from './utils/with-client.js'
import { getHulyClient } from './huly-client.js'

// Replace the entire try/catch/finally block (lines 19-40):
// from:
//   const client = await getHulyClient(userId)
//   try {
//     // ... logic
//   } catch (error) {
//     // ... error handling
//   } finally {
//     await client.close()
//   }
// to:
//   return withClient(userId, getHulyClient, async (client) => {
//     // ... logic
//   })
```

**Step 3: Run tests and commit**

```bash
bun test tests/huly/list-labels.test.ts
bun run lint
git add src/huly/list-labels.ts
git commit -m "refactor(huly): use withClient wrapper in list-labels"
```

---

## Task 24: Apply withClient to Another Simple File

**Files:**

- Modify: `src/huly/list-projects.ts`
- Test: `tests/huly/list-projects.test.ts` (existing)

**Step 1: Verify tests pass**

```bash
bun test tests/huly/list-projects.test.ts
```

**Step 2: Refactor to use withClient**

Apply the same pattern as Task 23.

**Step 3: Run tests and commit**

```bash
bun test tests/huly/list-projects.test.ts
bun run lint
git add src/huly/list-projects.ts
git commit -m "refactor(huly): use withClient wrapper in list-projects"
```

---

## Task 25: Create utils/index.ts Barrel Export

**Files:**

- Create: `src/huly/utils/index.ts`
- Test: No test needed for barrel exports

**Step 1: Create barrel export**

```typescript
// src/huly/utils/index.ts
export { numberToHexColor } from './color.js'
export { fetchIssue, fetchProject, fetchLabel } from './fetchers.js'
export { mapLinearPriorityToHuly, mapHulyPriorityToLinear } from './priority.js'
export { buildIssueUrl, buildIssueUrlByIdentifier } from './url-builder.js'
export { withClient } from './with-client.js'
```

**Step 2: Verify exports work**

```bash
bun build src/huly/utils/index.ts 2>&1 | head -20
```

Should compile without errors.

**Step 3: Commit**

```bash
git add src/huly/utils/index.ts
git commit -m "feat(huly): add utils barrel export"
```

---

## Task 26: Final Verification

**Step 1: Run all huly tests**

```bash
bun test tests/huly/
```

Expected: ALL PASS

**Step 2: Run linter**

```bash
bun run lint
```

Expected: No errors

**Step 3: Check for any remaining inline type definitions**

```bash
grep -r "type HulyClient = Awaited<ReturnType<typeof getHulyClient>>" src/huly/
```

Expected: No results (should all be removed)

**Step 4: Check for remaining priority mapping duplicates**

```bash
grep -r "function mapPriority" src/huly/
grep -r "function mapPriorityToNumber" src/huly/
```

Expected: Only in utils/priority.ts

**Step 5: Check for remaining color conversion duplicates**

```bash
grep -r "function numberToHexColor" src/huly/
```

Expected: Only in utils/color.ts

**Step 6: Final commit**

```bash
git add -A
git commit -m "refactor(huly): complete DRY refactoring - extract shared utilities

- Extract HulyClient type alias to types.ts
- Create priority mapping utilities (used by 3+ files)
- Create color conversion utility (used by 3 files)
- Create entity fetcher utilities (issue, project, label)
- Create URL builder utilities with project lookup
- Create withClient lifecycle wrapper
- Add barrel exports for utils

Reduces code duplication across 22 operation files"
```

---

## Summary

This refactoring extracts 6 major repetitive patterns:

1. **HulyClient type** → `types.ts` (eliminates 12 inline definitions)
2. **Priority mapping** → `utils/priority.ts` (eliminates 3 duplicate functions)
3. **Color conversion** → `utils/color.ts` (eliminates 3 duplicate functions)
4. **Entity fetchers** → `utils/fetchers.ts` (eliminates 14+ duplicate fetch patterns)
5. **URL builder** → `utils/url-builder.ts` (eliminates 10 duplicate URL constructions)
6. **Client lifecycle** → `utils/with-client.ts` (optional: can wrap all 22 files)

**Estimated reduction:** ~60% less duplicated code in src/huly/

**Risk level:** Low - all changes are pure refactoring with existing test coverage

**Testing strategy:** Each task includes tests; run full suite before/after each change
