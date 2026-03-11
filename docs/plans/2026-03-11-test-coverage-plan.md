# Enhanced Test Coverage Plan - Analysis & Improvements

## Executive Summary

The original test coverage plan provides a solid foundation but has several gaps, outdated assumptions, and missing critical edge cases. This enhanced version corrects errors and adds comprehensive edge case coverage.

---

## Critical Corrections to Original Plan

### 1. **Wrong Import Paths**

**Issue:** Multiple test files reference incorrect import paths:

```typescript
// WRONG (in original plan)
import { classifyKaneoError } from '../../src/kaneo/classify-error.js'

// CORRECT
import { classifyKaneoError } from '../../src/kaneo/index.js'
```

All kaneo modules are re-exported through `src/kaneo/index.js`, not individual files.

**Files affected:**

- Task 2, 4, 5, 6, 11, 12, 13, 17

### 2. **Missing Error Classes**

**Issue:** Tasks reference `KaneoApiError` and `KaneoValidationError` from wrong paths:

```typescript
// WRONG (in original plan)
import { KaneoApiError, KaneoValidationError } from '../../src/kaneo/client.js'

// CORRECT
import { KaneoApiError, KaneoValidationError } from '../../src/kaneo/errors.js'
```

These classes are defined in and exported from `src/kaneo/errors.js`.

### 3. **Task Resource Structure Mismatch**

**Issue:** The original plan assumes direct function exports for task operations, but they are actually organized as a resource object:

```typescript
// WRONG assumption in plan
import { createTask, updateTask, getTask, deleteTask, listTasks } from '../../src/kaneo/index.js'

// CORRECT actual usage
import { TaskResource } from '../../src/kaneo/index.js'
// TaskResource.create(), TaskResource.update(), etc.
```

**Same applies to:**

- `ProjectResource` (not `createProject`, `listProjects`)
- `LabelResource` (not `createLabel`, `listLabels`)
- `CommentResource` (not `addComment`, `listComments`)
- `ColumnResource` (not `listColumns`)

### 4. **Missing Frontmatter Relation Types**

**Issue:** The plan doesn't test all 6 relation types:

- `blocks`
- `blocked_by`
- `duplicate`
- `duplicate_of`
- `related`
- `parent`

### 5. **Missing Task Update Optimization Logic**

**Issue:** No tests for the critical single-field vs multi-field update optimization:

- Single field updates use dedicated endpoints (`/task/status/${taskId}`, etc.)
- Multi-field updates require GET to fetch `position` first, then PUT

### 6. **Missing Archive Label Flow**

**Issue:** No tests for:

- `getOrCreateArchiveLabel()` - finds/creates "archived" label
- `isTaskArchived()` - checks existing labels
- `addArchiveLabel()` - adds label to task

---

## Enhanced Test Coverage Plan

### Phase 1: Core Infrastructure (Critical)

#### Task 1: Kaneo Client Tests ✅ (Mostly Correct, Minor Fixes)

**Files:**

- Create: `tests/kaneo/client.test.ts`
- Target: `src/kaneo/client.ts`

**Corrections:**

```typescript
// Use correct import
import { kaneoFetch, KaneoTaskSchema, EmptyResponseSchema } from '../../src/kaneo/index.js'
import { KaneoApiError, KaneoValidationError } from '../../src/kaneo/errors.js'
```

**Enhanced Test Cases:**

```typescript
describe('kaneoFetch', () => {
  const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }

  beforeEach(() => {
    mock.restore()
  })

  // ✅ Original test
  test('makes GET request with correct headers', async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ id: '1', title: 'Test' }), { status: 200 })),
    )

    await kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, KaneoTaskSchema)

    expect(fetch).toHaveBeenCalled()
    const call = (fetch as Mock<typeof fetch>).mock.calls[0]
    expect(call[1].headers['Authorization']).toBe('Bearer test-key')
    expect(call[1].headers['Content-Type']).toBe('application/json')
  })

  // ✅ Original test
  test('throws KaneoApiError on non-ok response', async () => {
    global.fetch = mock(() => Promise.resolve(new Response('Not found', { status: 404 })))

    await expect(kaneoFetch(mockConfig, 'GET', '/tasks/1', undefined, {}, KaneoTaskSchema)).rejects.toThrow(
      KaneoApiError,
    )
  })

  // ✅ Original test
  test('throws KaneoValidationError on schema mismatch', async () => {
    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ invalid: 'data' }), { status: 200 })))

    await expect(kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, KaneoTaskSchema)).rejects.toThrow(
      KaneoValidationError,
    )
  })

  // ⭐ NEW: Test non-JSON response fallback
  test('handles non-JSON error response gracefully', async () => {
    global.fetch = mock(() => Promise.resolve(new Response('Plain text error', { status: 500 })))

    await expect(kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, KaneoTaskSchema)).rejects.toThrow(
      'Plain text error',
    )
  })

  // ⭐ NEW: Test URL query parameter encoding
  test('correctly encodes query parameters', async () => {
    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))

    await kaneoFetch(
      mockConfig,
      'GET',
      '/tasks',
      undefined,
      { search: 'hello world', special: 'a&b=c' },
      z.array(KaneoTaskSchema),
    )

    const call = (fetch as Mock<typeof fetch>).mock.calls[0]
    expect(call[0]).toContain('search=hello+world')
    expect(call[0]).toContain('special=a%26b%3Dc')
  })

  // ⭐ NEW: Test DELETE with empty response
  test('handles DELETE with empty response', async () => {
    global.fetch = mock(() => Promise.resolve(new Response(null, { status: 204 })))

    const result = await kaneoFetch(mockConfig, 'DELETE', '/tasks/1', undefined, {}, EmptyResponseSchema)
    expect(result).toBeUndefined()
  })

  // ⭐ NEW: Test POST with body
  test('sends JSON body for POST requests', async () => {
    global.fetch = mock((url, options) => {
      expect(options.body).toBe(JSON.stringify({ title: 'New Task' }))
      return Promise.resolve(new Response(JSON.stringify({ id: '1', title: 'New Task' }), { status: 200 }))
    })

    await kaneoFetch(mockConfig, 'POST', '/tasks', { title: 'New Task' }, {}, KaneoTaskSchema)
  })

  // ⭐ NEW: Test missing body is undefined
  test('does not send body when undefined', async () => {
    global.fetch = mock((url, options) => {
      expect(options.body).toBeUndefined()
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })

    await kaneoFetch(mockConfig, 'GET', '/tasks', undefined, {}, EmptyResponseSchema)
  })
})
```

---

#### Task 2: Kaneo Error Classifier Tests 🔄 (Major Corrections Required)

**Files:**

- Create: `tests/kaneo/classify-error.test.ts`
- Target: `src/kaneo/classify-error.ts`

**Critical Corrections:**

```typescript
// WRONG in original plan
import { classifyKaneoError } from '../../src/kaneo/classify-error.js'

// CORRECT
import { classifyKaneoError, KaneoClassifiedError } from '../../src/kaneo/index.js'
import { kaneoError, systemError } from '../../src/errors.js'
```

**Enhanced Test Cases:**

```typescript
describe('classifyKaneoError', () => {
  // ✅ Original test (correct)
  test('returns authFailed for 401', () => {
    const error = new Error('Unauthorized')
    ;(error as any).status = 401
    const result = classifyKaneoError(error)
    expect(result.error).toEqual(kaneoError.authFailed())
  })

  // ✅ Original test (correct)
  test('returns authFailed for 403', () => {
    const error = new Error('Forbidden')
    ;(error as any).status = 403
    const result = classifyKaneoError(error)
    expect(result.error).toEqual(kaneoError.authFailed())
  })

  // ⭐ NEW: Test 401 with message pattern
  test('returns authFailed for 401 with auth message', () => {
    const error = new Error('Authentication failed')
    ;(error as any).status = 401
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('auth-failed')
  })

  // ✅ Original test (needs correction)
  test('returns taskNotFound for 404 with task path', () => {
    const error = new Error('Not found')
    ;(error as any).status = 404
    const result = classifyKaneoError(error, 'task-123')
    expect(result.error).toEqual(kaneoError.taskNotFound('task-123'))
  })

  // ⭐ NEW: Test 404 with message containing "task"
  test('returns taskNotFound for 404 with task in message', () => {
    const error = new Error('Task not found')
    ;(error as any).status = 404
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('task-not-found')
  })

  // ⭐ NEW: Test 404 with message containing "/task/" path
  test('returns taskNotFound for 404 with /task/ path', () => {
    const error = new Error('GET /api/task/abc123 returned 404')
    ;(error as any).status = 404
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('task-not-found')
  })

  // ⭐ NEW: Test 404 with project detection
  test('returns projectNotFound for 404 with project in message', () => {
    const error = new Error('Project not found')
    ;(error as any).status = 404
    const result = classifyKaneoError(error, 'proj-123')
    expect(result.error).toEqual(kaneoError.projectNotFound('proj-123'))
  })

  // ⭐ NEW: Test 404 with label detection
  test('returns labelNotFound for 404 with label in message', () => {
    const error = new Error('Label not found')
    ;(error as any).status = 404
    const result = classifyKaneoError(error, 'urgent')
    expect(result.error.code).toBe('label-not-found')
  })

  // ⭐ NEW: Test 404 with comment detection
  test('returns commentNotFound for 404 with activity path', () => {
    const error = new Error('GET /api/activity/abc returned 404')
    ;(error as any).status = 404
    const result = classifyKaneoError(error, 'comment-123')
    expect(result.error.code).toBe('comment-not-found')
  })

  // ⭐ NEW: Test 404 default fallback
  test('returns taskNotFound as default for 404 without context', () => {
    const error = new Error('Not found')
    ;(error as any).status = 404
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('task-not-found')
  })

  // ✅ Original test (correct)
  test('returns rateLimited for 429', () => {
    const error = new Error('Too many requests')
    ;(error as any).status = 429
    const result = classifyKaneoError(error)
    expect(result.error).toEqual(kaneoError.rateLimited())
  })

  // ⭐ NEW: Test rate limit detection from message
  test('returns rateLimited for generic error with rate limit message', () => {
    const error = new Error('Rate limit exceeded, try again later')
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('rate-limited')
  })

  // ⭐ NEW: Test rate limit detection from 429 in message
  test('returns rateLimited for error message containing 429', () => {
    const error = new Error('Error 429: Rate limited')
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('rate-limited')
  })

  // ⭐ NEW: Test 400 validation failed
  test('returns validationFailed for 400', () => {
    const error = new Error('Bad request')
    ;(error as any).status = 400
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('validation-failed')
  })

  // ⭐ NEW: Test 500+ server errors
  test('returns unexpected for 500 server error', () => {
    const error = new Error('Internal server error')
    ;(error as any).status = 500
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('unexpected')
  })

  // ⭐ NEW: Test 502/503/504 gateway errors
  test('returns unexpected for gateway errors', () => {
    const error = new Error('Bad Gateway')
    ;(error as any).status = 502
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('unexpected')
  })

  // ⭐ NEW: Test auth detection from message without status
  test('returns authFailed for auth message without status', () => {
    const error = new Error('Unauthorized access')
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('auth-failed')
  })

  // ⭐ NEW: Test already classified error passthrough
  test('returns already classified errors unchanged', () => {
    const classified = new KaneoClassifiedError(kaneoError.taskNotFound('task-1'))
    const result = classifyKaneoError(classified)
    expect(result).toBe(classified)
    expect(result.error).toEqual(kaneoError.taskNotFound('task-1'))
  })

  // ⭐ NEW: Test non-Error object handling
  test('handles non-Error objects', () => {
    const result = classifyKaneoError('string error')
    expect(result.error.code).toBe('unexpected')
  })

  // ⭐ NEW: Test null/undefined error handling
  test('handles null error', () => {
    const result = classifyKaneoError(null)
    expect(result.error.code).toBe('unexpected')
  })

  // ⭐ NEW: Test error with only statusCode property (not status)
  test('handles error with statusCode instead of status', () => {
    const error = { statusCode: 404, message: 'Not found' }
    const result = classifyKaneoError(error)
    expect(result.error.code).toBe('task-not-found')
  })
})
```

---

#### Task 3: Frontmatter Parser Tests ✅ (Good Foundation, Needs Expansion)

**Files:**

- Create: `tests/kaneo/frontmatter.test.ts`
- Target: `src/kaneo/frontmatter.ts`

**Enhanced Test Cases:**

```typescript
import { describe, expect, test, mock } from 'bun:test'
import {
  parseRelationsFromDescription,
  buildDescriptionWithRelations,
  addRelation,
  removeRelation,
  updateRelation,
} from '../../src/kaneo/index.js'

describe('parseRelationsFromDescription', () => {
  // ✅ Original test
  test('returns empty for undefined', () => {
    const result = parseRelationsFromDescription(undefined)
    expect(result).toEqual({ relations: [], body: '' })
  })

  // ✅ Original test
  test('returns empty for null', () => {
    const result = parseRelationsFromDescription(null as any)
    expect(result).toEqual({ relations: [], body: '' })
  })

  // ✅ Original test
  test('returns empty for non-frontmatter text', () => {
    const result = parseRelationsFromDescription('Just text')
    expect(result).toEqual({ relations: [], body: 'Just text' })
  })

  // ⭐ NEW: Test empty string
  test('returns empty for empty string', () => {
    const result = parseRelationsFromDescription('')
    expect(result).toEqual({ relations: [], body: '' })
  })

  // ✅ Original test
  test('parses all relation types', () => {
    const desc = '---\nblocks: task-1, task-2\nrelated: task-3\n---\nBody text'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(3)
    expect(result.body).toBe('Body text')
  })

  // ⭐ NEW: Test all 6 relation types
  test('parses all relation type variants', () => {
    const desc = `---
blocks: task-1
blocked_by: task-2
duplicate: task-3
duplicate_of: task-4
related: task-5
parent: task-6
---
Body`
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(6)
    expect(result.relations.map((r) => r.type)).toContain('blocks')
    expect(result.relations.map((r) => r.type)).toContain('blocked_by')
    expect(result.relations.map((r) => r.type)).toContain('duplicate')
    expect(result.relations.map((r) => r.type)).toContain('duplicate_of')
    expect(result.relations.map((r) => r.type)).toContain('related')
    expect(result.relations.map((r) => r.type)).toContain('parent')
  })

  // ⭐ NEW: Test whitespace trimming in task IDs
  test('trims whitespace from task IDs', () => {
    const desc = '---\nblocks: task-1 , task-2 ,  task-3  \n---\nBody'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(3)
    expect(result.relations[0].taskId).toBe('task-1')
    expect(result.relations[1].taskId).toBe('task-2')
    expect(result.relations[2].taskId).toBe('task-3')
  })

  // ✅ Original test
  test('handles unclosed frontmatter', () => {
    const desc = '---\nblocks: task-1\nBody without closing'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toEqual([])
    expect(result.body).toBe(desc)
  })

  // ⭐ NEW: Test invalid relation type filtering
  test('filters out invalid relation types', () => {
    const desc = '---\nblocks: task-1\ninvalid_type: task-2\nrelated: task-3\n---\nBody'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(2)
    expect(result.relations.map((r) => r.type)).not.toContain('invalid_type')
  })

  // ⭐ NEW: Test empty relation values
  test('handles empty relation values', () => {
    const desc = '---\nblocks:\nrelated: task-1\n---\nBody'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(1)
    expect(result.relations[0].type).toBe('related')
  })

  // ⭐ NEW: Test multiple commas with spaces
  test('handles multiple comma-separated IDs', () => {
    const desc = '---\nblocks: task-1,task-2, task-3 ,task-4\n---\nBody'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(4)
  })

  // ⭐ NEW: Test preserving body with multiple newlines
  test('preserves body content with newlines', () => {
    const desc = '---\nblocks: task-1\n---\nLine 1\n\nLine 2\n\nLine 3'
    const result = parseRelationsFromDescription(desc)
    expect(result.body).toBe('Line 1\n\nLine 2\n\nLine 3')
  })

  // ⭐ NEW: Test frontmatter with extra whitespace
  test('handles frontmatter with extra whitespace', () => {
    const desc = '---  \n  blocks: task-1  \n  related: task-2  \n  ---  \nBody'
    const result = parseRelationsFromDescription(desc)
    expect(result.relations).toHaveLength(2)
    expect(result.body).toBe('Body')
  })
})

describe('buildDescriptionWithRelations', () => {
  // ✅ Original test (implied)
  test('builds description with relations', () => {
    const relations = [
      { type: 'blocks' as const, taskId: 'task-1' },
      { type: 'related' as const, taskId: 'task-2' },
    ]
    const result = buildDescriptionWithRelations('Body text', relations)
    expect(result).toContain('blocks: task-1')
    expect(result).toContain('related: task-2')
    expect(result).toContain('Body text')
  })

  // ⭐ NEW: Test empty relations
  test('returns body only when no relations', () => {
    const result = buildDescriptionWithRelations('Body text', [])
    expect(result).toBe('Body text')
  })

  // ⭐ NEW: Test grouping by relation type
  test('groups multiple relations of same type', () => {
    const relations = [
      { type: 'blocks' as const, taskId: 'task-1' },
      { type: 'blocks' as const, taskId: 'task-2' },
      { type: 'related' as const, taskId: 'task-3' },
    ]
    const result = buildDescriptionWithRelations('Body', relations)
    expect(result).toContain('blocks: task-1, task-2')
    expect(result).toContain('related: task-3')
  })

  // ⭐ NEW: Test empty body
  test('handles empty body', () => {
    const relations = [{ type: 'blocks' as const, taskId: 'task-1' }]
    const result = buildDescriptionWithRelations('', relations)
    expect(result).toContain('blocks: task-1')
  })

  // ⭐ NEW: Test all 6 relation types
  test('handles all relation types', () => {
    const relations = [
      { type: 'blocks' as const, taskId: 't1' },
      { type: 'blocked_by' as const, taskId: 't2' },
      { type: 'duplicate' as const, taskId: 't3' },
      { type: 'duplicate_of' as const, taskId: 't4' },
      { type: 'related' as const, taskId: 't5' },
      { type: 'parent' as const, taskId: 't6' },
    ]
    const result = buildDescriptionWithRelations('Body', relations)
    expect(result).toContain('blocks:')
    expect(result).toContain('blocked_by:')
    expect(result).toContain('duplicate:')
    expect(result).toContain('duplicate_of:')
    expect(result).toContain('related:')
    expect(result).toContain('parent:')
  })
})

describe('addRelation', () => {
  // ✅ Original test
  test('adds relation to empty description', () => {
    const result = addRelation('', { type: 'blocks', taskId: 'task-1' })
    expect(result).toContain('blocks: task-1')
  })

  // ✅ Original test
  test('skips duplicate relations', () => {
    const initial = '---\nblocks: task-1\n---\n'
    const result = addRelation(initial, { type: 'blocks', taskId: 'task-1' })
    const matches = result.match(/blocks: task-1/g)
    expect(matches ? matches.length : 0).toBe(1)
  })

  // ⭐ NEW: Test adding different relation type
  test('adds different relation type to existing', () => {
    const initial = '---\nblocks: task-1\n---\nBody'
    const result = addRelation(initial, { type: 'related', taskId: 'task-2' })
    expect(result).toContain('blocks: task-1')
    expect(result).toContain('related: task-2')
  })

  // ⭐ NEW: Test adding to same relation type (append)
  test('appends to existing relation type', () => {
    const initial = '---\nblocks: task-1\n---\nBody'
    const result = addRelation(initial, { type: 'blocks', taskId: 'task-2' })
    expect(result).toContain('blocks: task-1, task-2')
  })

  // ⭐ NEW: Test adding to description without frontmatter
  test('adds relation to plain text description', () => {
    const initial = 'Plain body text'
    const result = addRelation(initial, { type: 'related', taskId: 'task-1' })
    expect(result).toContain('---')
    expect(result).toContain('related: task-1')
    expect(result).toContain('Plain body text')
  })

  // ⭐ NEW: Test preserving existing body when adding relation
  test('preserves body content when adding relation', () => {
    const initial = 'Existing body with multiple lines\nand content'
    const result = addRelation(initial, { type: 'blocks', taskId: 'task-1' })
    expect(result).toContain('Existing body with multiple lines')
    expect(result).toContain('and content')
    expect(result.indexOf('---')).toBeLessThan(result.indexOf('Existing'))
  })
})

describe('removeRelation', () => {
  // ✅ Original test
  test('removes specific task relation', () => {
    const desc = '---\nblocks: task-1, task-2\n---\nBody'
    const result = removeRelation(desc, 'task-1')
    expect(result).toContain('task-2')
    expect(result).not.toContain('task-1')
  })

  // ⭐ NEW: Test removing only relation (removes frontmatter)
  test('removes frontmatter when removing only relation', () => {
    const desc = '---\nblocks: task-1\n---\nBody'
    const result = removeRelation(desc, 'task-1')
    expect(result).not.toContain('---')
    expect(result).toBe('Body')
  })

  // ⭐ NEW: Test removing from multiple relation types
  test('removes task from specific relation type only', () => {
    const desc = '---\nblocks: task-1\nrelated: task-1\n---\nBody'
    const result = removeRelation(desc, 'task-1')
    // Both should be removed since same taskId
    expect(result).not.toContain('task-1')
  })

  // ⭐ NEW: Test removing non-existent task
  test('handles removing non-existent task', () => {
    const desc = '---\nblocks: task-1\n---\nBody'
    const result = removeRelation(desc, 'task-999')
    expect(result).toContain('blocks: task-1')
  })

  // ⭐ NEW: Test removing from plain text (no frontmatter)
  test('returns unchanged when no frontmatter exists', () => {
    const desc = 'Plain body text'
    const result = removeRelation(desc, 'task-1')
    expect(result).toBe('Plain body text')
  })

  // ⭐ NEW: Test removing task that appears in middle of list
  test('removes task from middle of list', () => {
    const desc = '---\nblocks: task-1, task-2, task-3\n---\nBody'
    const result = removeRelation(desc, 'task-2')
    expect(result).toContain('blocks: task-1, task-3')
  })
})

describe('updateRelation', () => {
  // ✅ Original test
  test('changes relation type', () => {
    const desc = '---\nblocks: task-1\n---\nBody'
    const result = updateRelation(desc, 'task-1', 'related')
    expect(result).toContain('related: task-1')
    expect(result).not.toContain('blocks: task-1')
  })

  // ⭐ NEW: Test updating when task has multiple relations
  test('updates only specified relation type', () => {
    const desc = '---\nblocks: task-1, task-2\nrelated: task-1\n---\nBody'
    const result = updateRelation(desc, 'task-1', 'duplicate')
    // task-1 appears in both blocks and related
    // Should update one instance
    const blocksMatches = (result.match(/blocks:/g) || []).length
    const relatedMatches = (result.match(/related:/g) || []).length
    const duplicateMatches = (result.match(/duplicate:/g) || []).length
    expect(blocksMatches + relatedMatches + duplicateMatches).toBe(2)
  })

  // ⭐ NEW: Test updating non-existent task
  test('returns unchanged when task not found', () => {
    const desc = '---\nblocks: task-1\n---\nBody'
    const result = updateRelation(desc, 'task-999', 'related')
    expect(result).toContain('blocks: task-1')
    expect(result).not.toContain('related:')
  })

  // ⭐ NEW: Test updating to same type (no change)
  test('handles updating to same type', () => {
    const desc = '---\nblocks: task-1\n---\nBody'
    const result = updateRelation(desc, 'task-1', 'blocks')
    expect(result).toContain('blocks: task-1')
  })

  // ⭐ NEW: Test all relation type transitions
  test('supports all relation type updates', () => {
    const types = ['blocks', 'blocked_by', 'duplicate', 'duplicate_of', 'related', 'parent'] as const

    for (const fromType of types) {
      for (const toType of types) {
        if (fromType === toType) continue

        const desc = `---\n${fromType}: task-1\n---\nBody`
        const result = updateRelation(desc, 'task-1', toType)
        expect(result).toContain(`${toType}: task-1`)
      }
    }
  })
})
```

---

### Phase 2: Resource Functions (High Impact)

#### Task 4: Task Resource Tests 🔄 (Major Corrections Required)

**Files:**

- Create: `tests/kaneo/task-resource.test.ts`
- Target: `src/kaneo/task-resource.ts`

**Critical Corrections:**

```typescript
// WRONG in original plan
import { createTask, updateTask, getTask, deleteTask, listTasks } from '../../src/kaneo/index.js'

// CORRECT
import { TaskResource } from '../../src/kaneo/index.js'
```

**Enhanced Test Cases:**

```typescript
describe('TaskResource', () => {
  const mockConfig = { apiKey: 'test', baseUrl: 'https://test.com' }

  beforeEach(() => {
    mock.restore()
  })

  describe('create', () => {
    // ✅ Original concept (adapted to resource pattern)
    test('creates task with required fields', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test Task',
              number: 42,
              status: 'todo',
              priority: 'no-priority',
              description: '',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: null,
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        ),
      )

      const result = await TaskResource.create({
        config: mockConfig,
        projectId: 'proj-1',
        title: 'Test Task',
      })

      expect(result.id).toBe('task-1')
      expect(result.number).toBe(42)
    })

    // ✅ Original concept (adapted)
    test('includes optional fields in request', async () => {
      let requestBody: unknown
      global.fetch = mock((url: string, options: RequestInit) => {
        requestBody = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'high',
              description: 'Description',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: '2026-03-15',
              projectId: 'proj-1',
              userId: 'user-1',
            }),
            { status: 200 },
          ),
        )
      })

      await TaskResource.create({
        config: mockConfig,
        projectId: 'proj-1',
        title: 'Test',
        description: 'Description',
        priority: 'high',
        dueDate: '2026-03-15',
        status: 'in-progress',
      })

      expect(requestBody).toMatchObject({
        title: 'Test',
        description: 'Description',
        priority: 'high',
        dueDate: '2026-03-15',
        status: 'in-progress',
      })
    })

    // ⭐ NEW: Test priority default value
    test('applies default priority when not provided', async () => {
      let requestBody: unknown
      global.fetch = mock((url: string, options: RequestInit) => {
        requestBody = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'no-priority',
              description: '',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: null,
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        )
      })

      await TaskResource.create({
        config: mockConfig,
        projectId: 'proj-1',
        title: 'Test',
      })

      expect(requestBody).toMatchObject({ priority: 'no-priority' })
    })

    // ⭐ NEW: Test status default value
    test('applies default status when not provided', async () => {
      let requestBody: unknown
      global.fetch = mock((url: string, options: RequestInit) => {
        requestBody = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'no-priority',
              description: '',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: null,
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        )
      })

      await TaskResource.create({
        config: mockConfig,
        projectId: 'proj-1',
        title: 'Test',
      })

      expect(requestBody).toMatchObject({ status: 'todo' })
    })

    // ⭐ NEW: Test all priority values
    test('accepts all priority enum values', async () => {
      const priorities = ['no-priority', 'low', 'medium', 'high', 'urgent']

      for (const priority of priorities) {
        global.fetch = mock(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority,
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          ),
        )

        const result = await TaskResource.create({
          config: mockConfig,
          projectId: 'proj-1',
          title: 'Test',
          priority: priority as any,
        })

        expect(result.priority).toBe(priority)
      }
    })

    // ⭐ NEW: Test error classification
    test('classifies and throws on API error', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })),
      )

      await expect(
        TaskResource.create({
          config: mockConfig,
          projectId: 'invalid-proj',
          title: 'Test',
        }),
      ).rejects.toThrow()
    })
  })

  describe('get', () => {
    // ✅ Original concept
    test('fetches task with details', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'medium',
              description: 'Details',
              dueDate: null,
              projectId: 'proj-1',
              position: 0,
            }),
            { status: 200 },
          ),
        ),
      )

      const result = await TaskResource.get({ config: mockConfig, taskId: 'task-1' })
      expect(result.id).toBe('task-1')
      expect(result.description).toBe('Details')
    })

    // ⭐ NEW: Test parsing relations from description
    test('parses relations from description frontmatter', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'medium',
              description: '---\nblocks: task-2\nrelated: task-3\n---\nTask details',
              dueDate: null,
              projectId: 'proj-1',
              position: 0,
            }),
            { status: 200 },
          ),
        ),
      )

      const result = await TaskResource.get({ config: mockConfig, taskId: 'task-1' })
      expect(result.relations).toHaveLength(2)
      expect(result.relations[0].type).toBe('blocks')
      expect(result.relations[0].taskId).toBe('task-2')
    })

    // ⭐ NEW: Test empty description
    test('handles task with empty description', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'medium',
              description: '',
              dueDate: null,
              projectId: 'proj-1',
              position: 0,
            }),
            { status: 200 },
          ),
        ),
      )

      const result = await TaskResource.get({ config: mockConfig, taskId: 'task-1' })
      expect(result.relations).toEqual([])
    })

    // ⭐ NEW: Test 404 error
    test('throws taskNotFound for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })),
      )

      await expect(TaskResource.get({ config: mockConfig, taskId: 'invalid' })).rejects.toMatchObject({
        code: 'task-not-found',
      })
    })
  })

  describe('update', () => {
    // ⭐ CRITICAL: Test single field optimization
    describe('single field updates', () => {
      test('uses status endpoint for status update', async () => {
        let requestUrl: string
        global.fetch = mock((url: string, options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'done',
                priority: 'medium',
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        })

        await TaskResource.update({
          config: mockConfig,
          taskId: 'task-1',
          status: 'done',
        })

        expect(requestUrl).toContain('/task/status/task-1')
      })

      test('uses priority endpoint for priority update', async () => {
        let requestUrl: string
        global.fetch = mock((url: string, options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'high',
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        })

        await TaskResource.update({
          config: mockConfig,
          taskId: 'task-1',
          priority: 'high',
        })

        expect(requestUrl).toContain('/task/priority/task-1')
      })

      test('uses assign endpoint for userId update', async () => {
        let requestUrl: string
        global.fetch = mock((url: string, options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: 'user-123',
              }),
              { status: 200 },
            ),
          )
        })

        await TaskResource.update({
          config: mockConfig,
          taskId: 'task-1',
          userId: 'user-123',
        })

        expect(requestUrl).toContain('/task/assign/task-1')
      })

      test('uses dueDate endpoint for dueDate update', async () => {
        let requestUrl: string
        global.fetch = mock((url: string, options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: '2026-12-31',
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        })

        await TaskResource.update({
          config: mockConfig,
          taskId: 'task-1',
          dueDate: '2026-12-31',
        })

        expect(requestUrl).toContain('/task/due-date/task-1')
      })

      test('uses title endpoint for title update', async () => {
        let requestUrl: string
        global.fetch = mock((url: string, options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Updated Title',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        })

        await TaskResource.update({
          config: mockConfig,
          taskId: 'task-1',
          title: 'Updated Title',
        })

        expect(requestUrl).toContain('/task/title/task-1')
      })

      test('uses description endpoint for description update', async () => {
        let requestUrl: string
        global.fetch = mock((url: string, options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: 'Updated description',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        })

        await TaskResource.update({
          config: mockConfig,
          taskId: 'task-1',
          description: 'Updated description',
        })

        expect(requestUrl).toContain('/task/description/task-1')
      })
    })

    // ⭐ CRITICAL: Test multi-field update (requires GET first)
    describe('multi-field updates', () => {
      test('fetches position before multi-field update', async () => {
        let requestCount = 0
        global.fetch = mock((url: string, options: RequestInit) => {
          requestCount++
          if (url.includes('/task/task-1') && options.method === 'GET') {
            // Initial fetch to get position
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: 'task-1',
                  title: 'Old',
                  number: 1,
                  status: 'todo',
                  priority: 'medium',
                  description: 'Old desc',
                  createdAt: '2026-03-01T00:00:00Z',
                  dueDate: null,
                  projectId: 'proj-1',
                  position: 42,
                }),
                { status: 200 },
              ),
            )
          }
          // PUT update
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'New Title',
                number: 1,
                status: 'done',
                priority: 'high',
                description: 'New desc',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                position: 42,
              }),
              { status: 200 },
            ),
          )
        })

        await TaskResource.update({
          config: mockConfig,
          taskId: 'task-1',
          title: 'New Title',
          status: 'done',
          priority: 'high',
          description: 'New desc',
        })

        expect(requestCount).toBe(2)
      })

      test('uses PUT /task/task-1 for multi-field update', async () => {
        let requestUrl: string
        let requestBody: unknown

        global.fetch = mock((url: string, options: RequestInit) => {
          if (url.includes('/task/task-1') && options.method === 'GET') {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: 'task-1',
                  title: 'Old',
                  number: 1,
                  status: 'todo',
                  priority: 'medium',
                  description: 'Old',
                  createdAt: '2026-03-01T00:00:00Z',
                  dueDate: null,
                  projectId: 'proj-1',
                  position: 0,
                }),
                { status: 200 },
              ),
            )
          }
          requestUrl = url
          requestBody = JSON.parse(options.body as string)
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'New',
                number: 1,
                status: 'done',
                priority: 'high',
                description: 'New',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                position: 0,
              }),
              { status: 200 },
            ),
          )
        })

        await TaskResource.update({
          config: mockConfig,
          taskId: 'task-1',
          title: 'New',
          status: 'done',
        })

        expect(requestUrl).toContain('/task/task-1')
        expect(requestBody).toMatchObject({
          title: 'New',
          status: 'done',
          position: 0,
        })
      })
    })

    // ⭐ NEW: Test projectId update
    test('uses project endpoint for projectId update', async () => {
      let requestUrl: string
      global.fetch = mock((url: string, options: RequestInit) => {
        requestUrl = url
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'medium',
              description: '',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: null,
              projectId: 'new-proj',
              userId: null,
            }),
            { status: 200 },
          ),
        )
      })

      await TaskResource.update({
        config: mockConfig,
        taskId: 'task-1',
        projectId: 'new-proj',
      })

      expect(requestUrl).toContain('/task/project/task-1')
    })
  })

  describe('delete', () => {
    // ✅ Original concept
    test('deletes task successfully', async () => {
      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))

      await expect(TaskResource.delete({ config: mockConfig, taskId: 'task-1' })).resolves.not.toThrow()
    })

    // ⭐ NEW: Test 404 error
    test('throws taskNotFound for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })),
      )

      await expect(TaskResource.delete({ config: mockConfig, taskId: 'invalid' })).rejects.toMatchObject({
        code: 'task-not-found',
      })
    })
  })

  describe('list', () => {
    // ✅ Original concept (adapted)
    test('lists tasks for project', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'task-1', title: 'Task 1', number: 1, status: 'todo', priority: 'medium' },
              { id: 'task-2', title: 'Task 2', number: 2, status: 'done', priority: 'high' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const result = await TaskResource.list({ config: mockConfig, projectId: 'proj-1' })
      expect(result).toHaveLength(2)
      expect(result[0].title).toBe('Task 1')
    })

    // ⭐ NEW: Test empty list
    test('returns empty array when no tasks', async () => {
      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))

      const result = await TaskResource.list({ config: mockConfig, projectId: 'empty-proj' })
      expect(result).toHaveLength(0)
    })

    // ⭐ NEW: Test 404 project not found
    test('throws projectNotFound for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })),
      )

      await expect(TaskResource.list({ config: mockConfig, projectId: 'invalid' })).rejects.toMatchObject({
        code: 'project-not-found',
      })
    })
  })

  describe('search', () => {
    // ✅ Original concept (adapted)
    test('searches tasks by keyword', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [
                { id: 'task-1', title: 'Fix bug', number: 1, status: 'todo', priority: 'high' },
                { id: 'task-2', title: 'Bug report', number: 2, status: 'done', priority: 'medium' },
              ],
            }),
            { status: 200 },
          ),
        ),
      )

      const result = await TaskResource.search({
        config: mockConfig,
        query: 'bug',
        workspaceId: 'ws-1',
      })
      expect(result).toHaveLength(2)
    })

    // ⭐ NEW: Test with projectId filter
    test('filters by projectId when provided', async () => {
      let requestUrl: string
      global.fetch = mock((url: string) => {
        requestUrl = url
        return Promise.resolve(new Response(JSON.stringify({ tasks: [] }), { status: 200 }))
      })

      await TaskResource.search({
        config: mockConfig,
        query: 'test',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
      })

      expect(requestUrl).toContain('projectId=proj-1')
    })

    // ⭐ NEW: Test empty results
    test('returns empty array when no matches', async () => {
      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ tasks: [] }), { status: 200 })))

      const result = await TaskResource.search({
        config: mockConfig,
        query: 'nonexistent',
        workspaceId: 'ws-1',
      })
      expect(result).toEqual([])
    })
  })

  describe('archive', () => {
    // ⭐ NEW: Complete archive flow test
    test('archives task by adding label', async () => {
      let callCount = 0
      global.fetch = mock((url: string) => {
        callCount++

        if (url.includes('/label')) {
          // Get or create archive label
          return Promise.resolve(
            new Response(JSON.stringify([{ id: 'label-archive', name: 'archived', color: '#808080' }]), {
              status: 200,
            }),
          )
        }

        if (url.includes('/label/task/')) {
          // Get task labels
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }

        if (url.includes('/label/task-label')) {
          // Create task label
          return Promise.resolve(new Response(JSON.stringify({ id: 'tl-1' }), { status: 200 }))
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const result = await TaskResource.archive({
        config: mockConfig,
        taskId: 'task-1',
        workspaceId: 'ws-1',
      })

      expect(result.id).toBe('task-1')
      expect(callCount).toBeGreaterThanOrEqual(3)
    })

    // ⭐ NEW: Test already archived task
    test('skips already archived task', async () => {
      let callCount = 0
      global.fetch = mock((url: string) => {
        callCount++

        if (url.includes('/label') && !url.includes('/task/')) {
          return Promise.resolve(
            new Response(JSON.stringify([{ id: 'label-archive', name: 'archived', color: '#808080' }]), {
              status: 200,
            }),
          )
        }

        if (url.includes('/label/task/')) {
          // Task already has archive label
          return Promise.resolve(
            new Response(JSON.stringify([{ id: 'label-archive', name: 'archived', color: '#808080' }]), {
              status: 200,
            }),
          )
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const result = await TaskResource.archive({
        config: mockConfig,
        taskId: 'task-1',
        workspaceId: 'ws-1',
      })

      // Should not create task label since already archived
      expect(callCount).toBe(2) // Get labels + check task labels only
    })

    // ⭐ NEW: Test creates archive label if not exists
    test('creates archive label if not exists', async () => {
      let callCount = 0
      global.fetch = mock((url: string, options: RequestInit) => {
        callCount++

        if (url.includes('/label') && options.method === 'GET') {
          // No existing archive label
          return Promise.resolve(
            new Response(JSON.stringify([{ id: 'label-1', name: 'bug', color: '#ff0000' }]), { status: 200 }),
          )
        }

        if (url.includes('/label') && options.method === 'POST') {
          // Create archive label
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'label-archive',
                name: 'archived',
                color: '#808080',
              }),
              { status: 200 },
            ),
          )
        }

        if (url.includes('/label/task/')) {
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }

        if (url.includes('/label/task-label')) {
          return Promise.resolve(new Response(JSON.stringify({ id: 'tl-1' }), { status: 200 }))
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      await TaskResource.archive({
        config: mockConfig,
        taskId: 'task-1',
        workspaceId: 'ws-1',
      })

      expect(callCount).toBeGreaterThanOrEqual(4)
    })
  })

  describe('addRelation', () => {
    test('adds relation via description update', async () => {
      global.fetch = mock((url: string, options: RequestInit) => {
        if (options.method === 'GET') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: '---\nrelated: task-3\n---\nBody',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        }

        // PUT description update
        const body = JSON.parse(options.body as string)
        expect(body.description).toContain('blocks: task-2')
        expect(body.description).toContain('related: task-3')

        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
      })

      await TaskResource.addRelation({
        config: mockConfig,
        taskId: 'task-1',
        relatedTaskId: 'task-2',
        type: 'blocks',
      })
    })
  })

  describe('removeRelation', () => {
    test('removes relation via description update', async () => {
      global.fetch = mock((url: string, options: RequestInit) => {
        if (options.method === 'GET') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: '---\nblocks: task-2, task-3\n---\nBody',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        }

        // PUT description update
        const body = JSON.parse(options.body as string)
        expect(body.description).toContain('task-3')
        expect(body.description).not.toContain('task-2')

        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
      })

      await TaskResource.removeRelation({
        config: mockConfig,
        taskId: 'task-1',
        relatedTaskId: 'task-2',
      })
    })
  })

  describe('updateRelation', () => {
    test('updates relation type via description', async () => {
      global.fetch = mock((url: string, options: RequestInit) => {
        if (options.method === 'GET') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: '---\nblocks: task-2\n---\nBody',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        }

        // PUT description update
        const body = JSON.parse(options.body as string)
        expect(body.description).toContain('related: task-2')
        expect(body.description).not.toContain('blocks: task-2')

        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
      })

      await TaskResource.updateRelation({
        config: mockConfig,
        taskId: 'task-1',
        relatedTaskId: 'task-2',
        type: 'related',
      })
    })
  })
})
```

---

### Phase 3: Tools Layer (High Impact)

#### Task 7-15: Tool Tests 🔄 (Minor Corrections Required)

**Correction Pattern for All Tool Tests:**

```typescript
// All tool tests should use correct mock paths
// Mocking strategy: Use mock.module for kaneo/index.js imports

import { describe, expect, test, mock, beforeEach } from 'bun:test'
import { makeCreateTaskTool } from '../../src/tools/create-task.js'

const mockConfig = { apiKey: 'test', baseUrl: 'https://test.com' }

describe('makeCreateTaskTool', () => {
  beforeEach(() => {
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeCreateTaskTool(mockConfig, 'proj-1')
    expect(tool.description).toContain('Create a new task')
    expect(tool.parameters).toBeDefined()
  })

  test('creates task with required title', async () => {
    mock.module('../../src/kaneo/index.js', () => ({
      TaskResource: {
        create: mock(() =>
          Promise.resolve({
            id: 'task-1',
            title: 'Test Task',
            number: 42,
            status: 'todo',
          }),
        ),
      },
    }))

    const tool = makeCreateTaskTool(mockConfig, 'proj-1')
    const result = await tool.execute({ title: 'Test Task' }, { toolCallId: '1', messages: [] })

    expect(result).toMatchObject({
      id: 'task-1',
      title: 'Test Task',
      number: 42,
      status: 'todo',
    })
  })

  // ⭐ NEW: Additional edge cases for all tools
  test('uses default projectId when not provided', async () => {
    let capturedProjectId: string
    mock.module('../../src/kaneo/index.js', () => ({
      TaskResource: {
        create: mock((params: { projectId: string }) => {
          capturedProjectId = params.projectId
          return Promise.resolve({ id: '1', title: 'Test', number: 1, status: 'todo' })
        }),
      },
    }))

    const tool = makeCreateTaskTool(mockConfig, 'default-proj')
    await tool.execute({ title: 'Test' }, { toolCallId: '1', messages: [] })

    expect(capturedProjectId!).toBe('default-proj')
  })

  test('propagates API errors', async () => {
    mock.module('../../src/kaneo/index.js', () => ({
      TaskResource: {
        create: mock(() => Promise.reject(new Error('API Error'))),
      },
    }))

    const tool = makeCreateTaskTool(mockConfig, 'proj-1')
    await expect(tool.execute({ title: 'Test' }, { toolCallId: '1', messages: [] })).rejects.toThrow('API Error')
  })

  test('validates required parameters', async () => {
    const tool = makeCreateTaskTool(mockConfig, 'proj-1')
    // Zod validation should reject missing title
    await expect(tool.execute({}, { toolCallId: '1', messages: [] })).rejects.toThrow()
  })
})
```

**Additional Tool-Specific Edge Cases:**

| Tool                    | Additional Edge Cases                                       |
| ----------------------- | ----------------------------------------------------------- |
| `makeUpdateTaskTool`    | Partial updates, single vs multi-field, 404 handling        |
| `makeSearchTasksTool`   | Empty results, special characters in query, workspace bound |
| `makeGetTaskTool`       | Task with relations, task not found, invalid ID format      |
| `makeArchiveTaskTool`   | Already archived, workspace bound, archive label creation   |
| `makeListProjectsTool`  | Empty workspace, pagination if applicable                   |
| `makeCreateProjectTool` | Slug generation, description update flow                    |
| `makeAddCommentTool`    | Empty comment, very long comment                            |
| `makeGetCommentsTool`   | No comments, filtering non-comment activities               |

---

### Phase 4: Additional Critical Test Files

#### Task 16: Task Archive Tests (Enhanced)

**Files:**

- Create: `tests/kaneo/task-archive.test.ts`
- Target: `src/kaneo/task-archive.ts`

**Comprehensive Test Cases:**

```typescript
describe('Archive Label Management', () => {
  const mockConfig = { apiKey: 'test', baseUrl: 'https://test.com' }

  describe('getOrCreateArchiveLabel', () => {
    test('returns existing archived label', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'label-1', name: 'bug', color: '#ff0000' },
              { id: 'label-archive', name: 'archived', color: '#808080' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const result = await getOrCreateArchiveLabel(mockConfig, 'ws-1')
      expect(result.id).toBe('label-archive')
    })

    test('is case insensitive when finding label', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: 'label-1', name: 'ARCHIVED', color: '#808080' }]), { status: 200 }),
        ),
      )

      const result = await getOrCreateArchiveLabel(mockConfig, 'ws-1')
      expect(result.id).toBe('label-1')
    })

    test('creates new label if not exists', async () => {
      let callCount = 0
      global.fetch = mock((url: string, options: RequestInit) => {
        callCount++
        if (options.method === 'GET') {
          return Promise.resolve(
            new Response(JSON.stringify([{ id: 'label-1', name: 'bug', color: '#ff0000' }]), { status: 200 }),
          )
        }
        // POST create label
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-new',
              name: 'archived',
              color: '#808080',
            }),
            { status: 200 },
          ),
        )
      })

      const result = await getOrCreateArchiveLabel(mockConfig, 'ws-1')
      expect(result.name).toBe('archived')
      expect(result.color).toBe('#808080')
      expect(callCount).toBe(2)
    })

    test('uses correct archive label color', async () => {
      let capturedColor: string
      global.fetch = mock((url: string, options: RequestInit) => {
        if (options.method === 'POST') {
          const body = JSON.parse(options.body as string)
          capturedColor = body.color
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'archived',
              color: '#808080',
            }),
            { status: 200 },
          ),
        )
      })

      await getOrCreateArchiveLabel(mockConfig, 'ws-1')
      expect(capturedColor!).toBe('#808080')
    })
  })

  describe('isTaskArchived', () => {
    test('returns true when task has archive label', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'label-1', name: 'bug', color: '#ff0000' },
              { id: 'label-archive', name: 'archived', color: '#808080' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const result = await isTaskArchived(mockConfig, 'task-1', 'label-archive')
      expect(result).toBe(true)
    })

    test('returns false when task has no archive label', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: 'label-1', name: 'bug', color: '#ff0000' }]), { status: 200 }),
        ),
      )

      const result = await isTaskArchived(mockConfig, 'task-1', 'label-archive')
      expect(result).toBe(false)
    })

    test('returns false when task has no labels', async () => {
      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))

      const result = await isTaskArchived(mockConfig, 'task-1', 'label-archive')
      expect(result).toBe(false)
    })
  })

  describe('addArchiveLabel', () => {
    test('adds archive label to task', async () => {
      let requestBody: unknown
      global.fetch = mock((url: string, options: RequestInit) => {
        requestBody = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'tl-1',
              taskId: 'task-1',
              labelId: 'label-archive',
            }),
            { status: 200 },
          ),
        )
      })

      await addArchiveLabel(mockConfig, 'ws-1', 'task-1', 'label-archive')

      expect(requestBody).toMatchObject({
        taskId: 'task-1',
        labelId: 'label-archive',
      })
    })
  })
})
```

---

#### Task 17: Label Resource Tests (Enhanced)

**Files:**

- Create: `tests/kaneo/label-resource.test.ts`
- Target: `src/kaneo/label-resource.ts`

**Key Additional Tests:**

```typescript
describe('LabelResource', () => {
  const mockConfig = { apiKey: 'test', baseUrl: 'https://test.com' }

  describe('create', () => {
    test('uses default color when not provided', async () => {
      let capturedBody: unknown
      global.fetch = mock((url: string, options: RequestInit) => {
        capturedBody = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'new-label',
              color: '#6b7280',
            }),
            { status: 200 },
          ),
        )
      })

      await LabelResource.create({
        config: mockConfig,
        workspaceId: 'ws-1',
        name: 'new-label',
      })

      expect(capturedBody).toMatchObject({ color: '#6b7280' })
    })

    test('accepts custom color', async () => {
      let capturedBody: unknown
      global.fetch = mock((url: string, options: RequestInit) => {
        capturedBody = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'urgent',
              color: '#ff0000',
            }),
            { status: 200 },
          ),
        )
      })

      await LabelResource.create({
        config: mockConfig,
        workspaceId: 'ws-1',
        name: 'urgent',
        color: '#ff0000',
      })

      expect(capturedBody).toMatchObject({ color: '#ff0000' })
    })
  })

  describe('addToTask', () => {
    test('fetches label before creating task label', async () => {
      let callCount = 0
      global.fetch = mock((url: string) => {
        callCount++

        if (url.includes('/label/label-1') && !url.includes('/task')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'label-1',
                name: 'bug',
                color: '#ff0000',
              }),
              { status: 200 },
            ),
          )
        }

        if (url.includes('/label/task-label')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'tl-1',
                taskId: 'task-1',
                labelId: 'label-1',
              }),
              { status: 200 },
            ),
          )
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      await LabelResource.addToTask({
        config: mockConfig,
        taskId: 'task-1',
        labelId: 'label-1',
        workspaceId: 'ws-1',
      })

      expect(callCount).toBe(2)
    })

    test('throws labelNotFound when label does not exist', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 })),
      )

      await expect(
        LabelResource.addToTask({
          config: mockConfig,
          taskId: 'task-1',
          labelId: 'invalid-label',
          workspaceId: 'ws-1',
        }),
      ).rejects.toMatchObject({ code: 'label-not-found' })
    })
  })

  describe('removeFromTask', () => {
    test('finds and deletes task label', async () => {
      let callCount = 0
      let deleteUrl: string

      global.fetch = mock((url: string, options: RequestInit) => {
        callCount++

        if (url.includes('/label/task/task-1')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                { id: 'label-bug', name: 'bug', color: '#ff0000' },
                { id: 'label-urgent', name: 'urgent', color: '#ff0000' },
              ]),
              { status: 200 },
            ),
          )
        }

        if (options.method === 'DELETE') {
          deleteUrl = url
          return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      await LabelResource.removeFromTask({
        config: mockConfig,
        taskId: 'task-1',
        labelId: 'label-bug',
      })

      expect(callCount).toBe(2)
      expect(deleteUrl!).toContain('/label/task-label')
    })

    test('handles when task has no labels', async () => {
      global.fetch = mock((url: string) => {
        if (url.includes('/label/task/')) {
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      await expect(
        LabelResource.removeFromTask({
          config: mockConfig,
          taskId: 'task-1',
          labelId: 'label-bug',
        }),
      ).rejects.toThrow()
    })
  })
})
```

---

#### Task 18: Project Resource Tests (Enhanced)

**Files:**

- Create: `tests/kaneo/project-resource.test.ts`
- Target: `src/kaneo/project-resource.ts`

**Key Additional Tests:**

```typescript
describe('ProjectResource', () => {
  const mockConfig = { apiKey: 'test', baseUrl: 'https://test.com' }

  describe('create', () => {
    test('creates project with auto-generated slug', async () => {
      global.fetch = mock((url: string, options: RequestInit) => {
        if (options.method === 'POST') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'proj-1',
                name: 'My Project',
                slug: 'my-project',
              }),
              { status: 200 },
            ),
          )
        }
        // Description update
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'My Project',
              slug: 'my-project',
            }),
            { status: 200 },
          ),
        )
      })

      const result = await ProjectResource.create({
        config: mockConfig,
        workspaceId: 'ws-1',
        name: 'My Project',
      })

      expect(result.slug).toBe('my-project')
    })

    test('generates slug with special characters', async () => {
      global.fetch = mock((url: string, options: RequestInit) => {
        if (options.method === 'POST') {
          const body = JSON.parse(options.body as string)
          expect(body.slug).toBe('my-project-test')
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'proj-1',
                name: 'My Project @ Test!',
                slug: 'my-project-test',
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      await ProjectResource.create({
        config: mockConfig,
        workspaceId: 'ws-1',
        name: 'My Project @ Test!',
      })
    })

    test('updates description in separate call', async () => {
      let callCount = 0
      let lastUrl: string
      let lastBody: unknown

      global.fetch = mock((url: string, options: RequestInit) => {
        callCount++
        lastUrl = url
        lastBody = options.body ? JSON.parse(options.body as string) : undefined

        if (options.method === 'POST') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'proj-1',
                name: 'Test Project',
                slug: 'test-project',
              }),
              { status: 200 },
            ),
          )
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Test Project',
              slug: 'test-project',
            }),
            { status: 200 },
          ),
        )
      })

      await ProjectResource.create({
        config: mockConfig,
        workspaceId: 'ws-1',
        name: 'Test Project',
        description: 'Project description',
      })

      expect(callCount).toBe(2)
      expect(lastUrl!).toContain('/project/proj-1')
      expect(lastBody).toMatchObject({ description: 'Project description' })
    })

    test('creates project without description', async () => {
      let callCount = 0

      global.fetch = mock(() => {
        callCount++
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Test',
              slug: 'test',
            }),
            { status: 200 },
          ),
        )
      })

      await ProjectResource.create({
        config: mockConfig,
        workspaceId: 'ws-1',
        name: 'Test',
      })

      expect(callCount).toBe(1) // Only one call, no description update
    })
  })

  describe('update', () => {
    test('updates only name', async () => {
      let capturedBody: unknown
      global.fetch = mock((url: string, options: RequestInit) => {
        capturedBody = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Updated Name',
              slug: 'updated-name',
            }),
            { status: 200 },
          ),
        )
      })

      await ProjectResource.update({
        config: mockConfig,
        projectId: 'proj-1',
        name: 'Updated Name',
      })

      expect(capturedBody).toEqual({ name: 'Updated Name' })
    })

    test('updates only description', async () => {
      let capturedBody: unknown
      global.fetch = mock((url: string, options: RequestInit) => {
        capturedBody = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Test',
              slug: 'test',
            }),
            { status: 200 },
          ),
        )
      })

      await ProjectResource.update({
        config: mockConfig,
        projectId: 'proj-1',
        description: 'New description',
      })

      expect(capturedBody).toEqual({ description: 'New description' })
    })

    test('updates both name and description', async () => {
      let capturedBody: unknown
      global.fetch = mock((url: string, options: RequestInit) => {
        capturedBody = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'New Name',
              slug: 'new-name',
            }),
            { status: 200 },
          ),
        )
      })

      await ProjectResource.update({
        config: mockConfig,
        projectId: 'proj-1',
        name: 'New Name',
        description: 'New description',
      })

      expect(capturedBody).toMatchObject({
        name: 'New Name',
        description: 'New description',
      })
    })
  })

  describe('archive', () => {
    test('archives project successfully', async () => {
      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))

      await expect(
        ProjectResource.archive({
          config: mockConfig,
          projectId: 'proj-1',
        }),
      ).resolves.not.toThrow()
    })

    test('throws projectNotFound for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })),
      )

      await expect(
        ProjectResource.archive({
          config: mockConfig,
          projectId: 'invalid',
        }),
      ).rejects.toMatchObject({ code: 'project-not-found' })
    })
  })
})
```

---

#### Task 19: Comment Resource Tests (Enhanced)

**Files:**

- Create: `tests/kaneo/comment-resource.test.ts`
- Target: `src/kaneo/comment-resource.ts`

**Key Additional Tests:**

```typescript
describe('CommentResource', () => {
  const mockConfig = { apiKey: 'test', baseUrl: 'https://test.com' }

  describe('list', () => {
    test('filters only comment activities', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'act-1', type: 'comment', comment: 'Comment 1', message: null, createdAt: '2026-03-01T00:00:00Z' },
              {
                id: 'act-2',
                type: 'status_change',
                comment: null,
                message: 'Status changed',
                createdAt: '2026-03-01T00:00:00Z',
              },
              { id: 'act-3', type: 'comment', comment: 'Comment 2', message: null, createdAt: '2026-03-02T00:00:00Z' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const result = await CommentResource.list({ config: mockConfig, taskId: 'task-1' })
      expect(result).toHaveLength(2)
      expect(result[0].comment).toBe('Comment 1')
      expect(result[1].comment).toBe('Comment 2')
    })

    test('excludes activities with null comment', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'act-1',
                type: 'comment',
                comment: 'Valid comment',
                message: null,
                createdAt: '2026-03-01T00:00:00Z',
              },
              { id: 'act-2', type: 'comment', comment: null, message: null, createdAt: '2026-03-01T00:00:00Z' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const result = await CommentResource.list({ config: mockConfig, taskId: 'task-1' })
      expect(result).toHaveLength(1)
      expect(result[0].comment).toBe('Valid comment')
    })

    test('returns empty array when no comments', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'act-1',
                type: 'status_change',
                comment: null,
                message: 'Changed',
                createdAt: '2026-03-01T00:00:00Z',
              },
            ]),
            { status: 200 },
          ),
        ),
      )

      const result = await CommentResource.list({ config: mockConfig, taskId: 'task-1' })
      expect(result).toHaveLength(0)
    })

    test('maps to simplified structure', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'act-1', type: 'comment', comment: 'Test', message: null, createdAt: '2026-03-01T12:00:00Z' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const result = await CommentResource.list({ config: mockConfig, taskId: 'task-1' })
      expect(result[0]).toMatchObject({
        id: 'act-1',
        comment: 'Test',
        createdAt: '2026-03-01T12:00:00Z',
      })
    })
  })

  describe('add', () => {
    test('adds comment to task', async () => {
      global.fetch = mock((url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              comment: body.comment,
              createdAt: '2026-03-01T00:00:00Z',
            }),
            { status: 200 },
          ),
        )
      })

      const result = await CommentResource.add({
        config: mockConfig,
        taskId: 'task-1',
        comment: 'New comment',
      })

      expect(result.id).toBe('comment-1')
      expect(result.comment).toBe('New comment')
    })

    test('handles empty comment', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              comment: '',
              createdAt: '2026-03-01T00:00:00Z',
            }),
            { status: 200 },
          ),
        ),
      )

      const result = await CommentResource.add({
        config: mockConfig,
        taskId: 'task-1',
        comment: '',
      })

      expect(result.comment).toBe('')
    })

    test('throws taskNotFound for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })),
      )

      await expect(
        CommentResource.add({
          config: mockConfig,
          taskId: 'invalid',
          comment: 'Test',
        }),
      ).rejects.toMatchObject({ code: 'task-not-found' })
    })
  })

  describe('update', () => {
    test('updates existing comment', async () => {
      let capturedBody: unknown
      global.fetch = mock((url: string, options: RequestInit) => {
        capturedBody = JSON.parse(options.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              comment: 'Updated',
              createdAt: '2026-03-01T00:00:00Z',
            }),
            { status: 200 },
          ),
        )
      })

      await CommentResource.update({
        config: mockConfig,
        commentId: 'comment-1',
        comment: 'Updated',
      })

      expect(capturedBody).toMatchObject({ comment: 'Updated' })
    })

    test('throws commentNotFound for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 })),
      )

      await expect(
        CommentResource.update({
          config: mockConfig,
          commentId: 'invalid',
          comment: 'Updated',
        }),
      ).rejects.toMatchObject({ code: 'comment-not-found' })
    })
  })

  describe('remove', () => {
    test('removes comment successfully', async () => {
      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))

      await expect(
        CommentResource.remove({
          config: mockConfig,
          commentId: 'comment-1',
        }),
      ).resolves.not.toThrow()
    })

    test('throws commentNotFound for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 })),
      )

      await expect(
        CommentResource.remove({
          config: mockConfig,
          commentId: 'invalid',
        }),
      ).rejects.toMatchObject({ code: 'comment-not-found' })
    })
  })
})
```

---

## Summary of Critical Improvements

### 1. **Import Path Corrections**

- All kaneo resources are exported from `src/kaneo/index.js`, not individual files
- Error classes are in `src/kaneo/errors.js`, not `client.ts`

### 2. **Resource Pattern Recognition**

- TaskResource, ProjectResource, LabelResource, CommentResource, ColumnResource are **objects with methods**, not standalone functions

### 3. **Critical Missing Coverage Added**

- Single-field vs multi-field update optimization in TaskResource
- Archive label flow (getOrCreateArchiveLabel, isTaskArchived, addArchiveLabel)
- All 6 relation types in frontmatter
- Project creation two-step process
- Label add/remove with prerequisite fetching
- Comment filtering from activities

### 4. **Edge Cases Added**

- Unclosed frontmatter blocks
- Empty/null/undefined descriptions
- Multiple comma-separated task IDs
- Whitespace trimming
- Invalid relation type filtering
- Already classified error passthrough
- Non-Error object handling
- Case-insensitive label matching
- Already archived task detection

### 5. **Error Classification Tests**

- All HTTP status codes (400, 401, 403, 404, 429, 500, 502, 503, 504)
- Message pattern matching for resource type detection
- Rate limit detection from message
- Auth detection from message without status

---

## Implementation Priority (Revised)

1. **Phase 1** (Critical - Blocking):
   - Task 1: Client tests (correct imports)
   - Task 2: Error classifier (major corrections needed)
   - Task 3: Frontmatter (edge cases)

2. **Phase 2** (High - Core functionality):
   - Task 4: TaskResource (resource pattern + update optimization)
   - Task 16: Task archive (missing from original)
   - Task 18: ProjectResource (two-step creation)

3. **Phase 3** (High - Tools):
   - Tasks 7-15: Tool tests (correct mock patterns)

4. **Phase 4** (Medium - Supporting resources):
   - Task 17: LabelResource (add/remove complexity)
   - Task 19: CommentResource (filtering logic)
   - Task 13: ColumnResource

---

**This enhanced plan addresses all structural issues in the original and adds comprehensive edge case coverage.**
