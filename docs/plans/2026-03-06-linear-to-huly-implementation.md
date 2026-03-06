# Linear to Huly Migration Implementation Plan (CORRECTED)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Linear SDK with Huly API Client while preserving all 22 tool interfaces and user experience.

**Architecture:** Direct replacement - rewrite all files in `src/linear/` to use `@hcengineering/api-client`, then rename directory to `src/huly/`. Maintain identical tool signatures so Telegram bot and LLM are unaffected.

**Tech Stack:** TypeScript, Bun, @hcengineering/api-client, @hcengineering/core, @hcengineering/tracker, @hcengineering/tags, @hcengineering/task, @hcengineering/rank, Zod, Vercel AI SDK

---

## Task 0: Configure GitHub Packages Authentication (Prerequisite)

**Files:**

- Create: `.npmrc`

**Step 1: Create .npmrc for GitHub Packages**

Create: `.npmrc`

```
@hcengineering:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

**Step 2: Verify GITHUB_TOKEN is set**

The environment variable `GITHUB_TOKEN` must contain a GitHub personal access token with `read:packages` scope.

**Step 3: Commit**

```bash
git add .npmrc
git commit -m "chore: add GitHub Packages authentication for @hcengineering"
```

---

## Task 1: Add Huly Dependencies

**Files:**

- Modify: `package.json`

**Step 1: Add Huly packages**

Add to dependencies section:

```json
{
  "@hcengineering/api-client": "^0.7.0",
  "@hcengineering/core": "^0.7.0",
  "@hcengineering/tracker": "^0.7.0",
  "@hcengineering/tags": "^0.7.0",
  "@hcengineering/task": "^0.7.0",
  "@hcengineering/rank": "^0.7.0"
}
```

**Step 2: Install dependencies**

Run: `bun install`
Expected: Packages installed successfully

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add Huly API client packages"
```

---

## Task 2: Update Configuration Types

**Files:**

- Modify: `src/config.ts`

**Step 1: Write failing test**

Create: `tests/config-huly-keys.test.ts`

```typescript
import { describe, it, expect } from 'bun:test'
import { isConfigKey, CONFIG_KEYS, type ConfigKey } from '../src/config.js'

describe('Huly config keys', () => {
  it('should include huly_email', () => {
    expect(isConfigKey('huly_email')).toBe(true)
  })

  it('should include huly_password', () => {
    expect(isConfigKey('huly_password')).toBe(true)
  })

  it('should NOT include linear_key', () => {
    expect(isConfigKey('linear_key')).toBe(false)
  })

  it('should NOT include linear_team_id', () => {
    expect(isConfigKey('linear_team_id')).toBe(false)
  })

  it('should still include openai_key', () => {
    expect(isConfigKey('openai_key')).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/config-huly-keys.test.ts`
Expected: FAIL - "huly_email" not recognized

**Step 3: Update config types**

Modify: `src/config.ts`
Replace:

```typescript
export type ConfigKey =
  | 'linear_key'
  | 'linear_team_id'
  | 'openai_key'
  | 'openai_base_url'
  | 'openai_model'
  | 'memory_model'

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'linear_key',
  'linear_team_id',
  'openai_key',
  'openai_base_url',
  'openai_model',
  'memory_model',
]

const SENSITIVE_KEYS: ReadonlySet<ConfigKey> = new Set(['linear_key', 'openai_key'])
```

With:

```typescript
export type ConfigKey =
  | 'huly_email'
  | 'huly_password'
  | 'openai_key'
  | 'openai_base_url'
  | 'openai_model'
  | 'memory_model'

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'huly_email',
  'huly_password',
  'openai_key',
  'openai_base_url',
  'openai_model',
  'memory_model',
]

const SENSITIVE_KEYS: ReadonlySet<ConfigKey> = new Set(['huly_password', 'openai_key'])
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/config-huly-keys.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts tests/config-huly-keys.test.ts
git commit -m "feat(config): replace Linear keys with Huly auth config"
```

---

## Task 3: Create Huly Client Factory

**Files:**

- Create: `src/linear/huly-client.ts`
- Create: `tests/linear/huly-client.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { getHulyClient } from '../../src/linear/huly-client.js'
import { setConfig } from '../../src/config.js'
import { getDb } from '../../src/db/index.js'

describe('getHulyClient', () => {
  const userId = 999999

  beforeEach(() => {
    process.env.HULY_URL = 'http://localhost:8087'
    process.env.HULY_WORKSPACE = 'test-workspace'
    setConfig(userId, 'huly_email', 'test@example.com')
    setConfig(userId, 'huly_password', 'testpass123')
  })

  afterEach(() => {
    getDb().run('DELETE FROM user_config WHERE user_id = ?', [userId])
  })

  it('should throw if HULY_URL env var is missing', async () => {
    const originalUrl = process.env.HULY_URL
    delete process.env.HULY_URL

    await expect(getHulyClient(userId)).rejects.toThrow('HULY_URL')

    process.env.HULY_URL = originalUrl
  })

  it('should throw if HULY_WORKSPACE env var is missing', async () => {
    const originalWorkspace = process.env.HULY_WORKSPACE
    delete process.env.HULY_WORKSPACE

    await expect(getHulyClient(userId)).rejects.toThrow('HULY_WORKSPACE')

    process.env.HULY_WORKSPACE = originalWorkspace
  })

  it('should throw if user email not configured', async () => {
    getDb().run('DELETE FROM user_config WHERE user_id = ? AND key = ?', [userId, 'huly_email'])

    await expect(getHulyClient(userId)).rejects.toThrow('huly_email')
  })

  it('should throw if user password not configured', async () => {
    getDb().run('DELETE FROM user_config WHERE user_id = ? AND key = ?', [userId, 'huly_password'])

    await expect(getHulyClient(userId)).rejects.toThrow('huly_password')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/linear/huly-client.test.ts`
Expected: FAIL - module not found

**Step 3: Implement Huly client factory**

Create: `src/linear/huly-client.ts`

```typescript
import { connect, NodeWebSocketFactory } from '@hcengineering/api-client'
import { getConfig } from '../config.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'huly-client' })

export interface HulyClientConfig {
  url: string
  email: string
  password: string
  workspace: string
}

export async function getHulyClient(userId: number) {
  log.debug({ userId }, 'getHulyClient called')

  const url = process.env.HULY_URL
  if (!url) {
    log.error({}, 'HULY_URL environment variable not set')
    throw new Error('HULY_URL environment variable is required')
  }

  const workspace = process.env.HULY_WORKSPACE
  if (!workspace) {
    log.error({}, 'HULY_WORKSPACE environment variable not set')
    throw new Error('HULY_WORKSPACE environment variable is required')
  }

  const email = getConfig(userId, 'huly_email')
  if (!email) {
    log.error({ userId }, 'huly_email not configured for user')
    throw new Error('huly_email not configured. Use /set huly_email <email>')
  }

  const password = getConfig(userId, 'huly_password')
  if (!password) {
    log.error({ userId }, 'huly_password not configured for user')
    throw new Error('huly_password not configured. Use /set huly_password <password>')
  }

  log.info({ userId, workspace }, 'Connecting to Huly')

  const client = await connect(url, {
    email,
    password,
    workspace,
    socketFactory: NodeWebSocketFactory,
    connectionTimeout: 30000,
  })

  return client
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/linear/huly-client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/linear/huly-client.ts tests/linear/huly-client.test.ts
git commit -m "feat(huly): add client factory with env validation"
```

---

## Task 4: Implement Project Auto-Creation Utility

**Files:**

- Create: `src/linear/project-utils.ts`
- Create: `tests/linear/project-utils.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from 'bun:test'
import { getOrCreateUserProject, formatProjectIdentifier } from '../../src/linear/project-utils.js'

describe('formatProjectIdentifier', () => {
  it('should format username correctly', () => {
    expect(formatProjectIdentifier('alice')).toBe('P-ALICE')
  })

  it('should format userId correctly', () => {
    expect(formatProjectIdentifier(12345)).toBe('P-12345')
  })

  it('should handle special characters', () => {
    expect(formatProjectIdentifier('user_name-123')).toBe('P-USER_NAME-123')
  })
})

describe('getOrCreateUserProject', () => {
  // Mock tests for project creation logic
  it('should be defined', () => {
    expect(getOrCreateUserProject).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/linear/project-utils.test.ts`
Expected: FAIL - module not found

**Step 3: Implement project utilities**

Create: `src/linear/project-utils.ts`

```typescript
import type { Client } from '@hcengineering/api-client'
import tracker from '@hcengineering/tracker'
import core from '@hcengineering/core'
import { generateId } from '@hcengineering/core'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'huly:project-utils' })

export function formatProjectIdentifier(userIdentifier: string | number): string {
  const normalized = String(userIdentifier)
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
  return `P-${normalized}`
}

export async function getOrCreateUserProject(
  client: Client,
  userIdentifier: string | number,
): Promise<{ _id: string; identifier: string }> {
  const projectIdentifier = formatProjectIdentifier(userIdentifier)
  log.debug({ projectIdentifier }, 'Looking up user project')

  // Try to find existing project
  const existingProject = await client.findOne(tracker.class.Project, {
    identifier: projectIdentifier,
  })

  if (existingProject) {
    log.info({ projectId: existingProject._id, identifier: projectIdentifier }, 'Found existing project')
    return { _id: existingProject._id as string, identifier: projectIdentifier }
  }

  // Create new project
  log.info({ identifier: projectIdentifier }, 'Creating new project for user')

  const projectId = generateId()

  // Get workspace space for project creation
  const workspaceSpace = await client.findOne(core.class.Space, {
    _id: core.space.Workspace,
  })

  if (!workspaceSpace) {
    throw new Error('Workspace space not found')
  }

  await client.createDoc(
    tracker.class.Project,
    core.space.Space,
    {
      name: `Project ${userIdentifier}`,
      identifier: projectIdentifier,
      description: `Auto-created project for user ${userIdentifier}`,
      private: false,
      defaultIssueStatus: null, // Will be set by Huly
      members: [],
    },
    projectId,
  )

  log.info({ projectId, identifier: projectIdentifier }, 'Created new project')

  return { _id: projectId, identifier: projectIdentifier }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/linear/project-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/linear/project-utils.ts tests/linear/project-utils.test.ts
git commit -m "feat(huly): add project auto-creation utility"
```

---

## Task 5: Implement Huly Error Classifier

**Files:**

- Modify: `src/linear/classify-error.ts`
- Create: `tests/linear/classify-error.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'bun:test'
import { classifyHulyError, HulyApiError } from '../../src/linear/classify-error.js'

describe('classifyHulyError', () => {
  it('should classify authentication errors', () => {
    const error = new Error('Authentication failed')
    const result = classifyHulyError(error)
    expect(result).toBeInstanceOf(HulyApiError)
    expect(result.appError.type).toBe('linear') // Keep type for compatibility
    expect(result.appError.code).toBe('auth-failed')
  })

  it('should classify not found errors', () => {
    const error = new Error('Document not found')
    const result = classifyHulyError(error)
    expect(result).toBeInstanceOf(HulyApiError)
    expect(result.appError.code).toBe('issue-not-found')
  })

  it('should classify validation errors', () => {
    const error = new Error('Invalid input')
    const result = classifyHulyError(error)
    expect(result).toBeInstanceOf(HulyApiError)
    expect(result.appError.code).toBe('validation-failed')
  })

  it('should wrap unknown errors', () => {
    const error = new Error('Something else')
    const result = classifyHulyError(error)
    expect(result).toBeInstanceOf(HulyApiError)
    expect(result.appError.type).toBe('system')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/linear/classify-error.test.ts`
Expected: FAIL - classifyHulyError not found

**Step 3: Implement Huly error classifier**

Replace contents of `src/linear/classify-error.ts`:

```typescript
import { type AppError, linearError, systemError } from '../errors.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'huly:classify-error' })

export class HulyApiError extends Error {
  constructor(
    message: string,
    public readonly appError: AppError,
  ) {
    super(message)
    this.name = 'HulyApiError'
  }
}

export function classifyHulyError(error: unknown): HulyApiError {
  log.debug({ error: error instanceof Error ? error.message : String(error) }, 'Classifying Huly error')

  if (error instanceof HulyApiError) {
    return error
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    // Authentication errors
    if (
      message.includes('authentication') ||
      message.includes('unauthorized') ||
      message.includes('invalid credentials') ||
      message.includes('login failed')
    ) {
      log.warn({ error: message }, 'Authentication error detected')
      return new HulyApiError(error.message, linearError.authFailed())
    }

    // Not found errors
    if (message.includes('not found') || message.includes('does not exist') || message.includes('document not found')) {
      log.warn({ error: message }, 'Not found error detected')
      return new HulyApiError(error.message, linearError.issueNotFound('unknown'))
    }

    // Validation errors
    if (
      message.includes('invalid') ||
      message.includes('validation') ||
      message.includes('required') ||
      message.includes('cannot be empty')
    ) {
      log.warn({ error: message }, 'Validation error detected')
      return new HulyApiError(error.message, linearError.validationFailed('unknown', error.message))
    }

    // Rate limit errors
    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
      log.warn({ error: message }, 'Rate limit error detected')
      return new HulyApiError(error.message, linearError.rateLimited())
    }
  }

  // Default: wrap as system error
  const errorMessage = error instanceof Error ? error.message : String(error)
  log.debug({ error: errorMessage }, 'Unknown error type, wrapping as system error')
  return new HulyApiError(
    errorMessage,
    systemError.unexpected(error instanceof Error ? error : new Error(errorMessage)),
  )
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/linear/classify-error.test.ts`
Expected: PASS

**Step 5: Update all imports to use classifyHulyError**

Search and replace in all `src/linear/*.ts` files (except mocks):

```typescript
import { classifyLinearError } from './classify-error.js'
```

to:

```typescript
import { classifyHulyError } from './classify-error.js'
```

And update function calls from `classifyLinearError(error)` to `classifyHulyError(error)`.

**Step 6: Commit**

```bash
git add src/linear/classify-error.ts tests/linear/classify-error.test.ts
git commit -m "feat(huly): implement error classifier for Huly API"
```

---

## Task 6: Rewrite create-issue.ts

**Files:**

- Modify: `src/linear/create-issue.ts`
- Modify: `tests/linear/create-issue.test.ts`

**Step 1: Write failing test with Huly structure**

Update test to expect Huly return shape:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test'
import { createIssue } from '../../src/linear/create-issue.js'

describe('createIssue with Huly', () => {
  const mockUserId = 12345

  beforeEach(() => {
    process.env.HULY_URL = 'http://localhost:8087'
    process.env.HULY_WORKSPACE = 'test-workspace'
  })

  it('should create an issue with required fields', async () => {
    const result = await createIssue({
      userId: mockUserId,
      title: 'Test Issue',
      projectId: 'project-123',
    })

    expect(result).toBeDefined()
    expect(result.id).toBeDefined()
    expect(result.identifier).toMatch(/^P-\d+-\d+$/)
    expect(result.title).toBe('Test Issue')
    expect(result.url).toBeDefined()
  })

  it('should create an issue with all optional fields', async () => {
    const result = await createIssue({
      userId: mockUserId,
      title: 'Test Issue with Options',
      description: 'Description here',
      priority: 1,
      projectId: 'project-123',
      dueDate: '2026-03-15',
      labelIds: ['label-1', 'label-2'],
      estimate: 5,
    })

    expect(result).toBeDefined()
    expect(result.title).toBe('Test Issue with Options')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/linear/create-issue.test.ts`
Expected: FAIL - implementation doesn't match

**Step 3: Rewrite create-issue.ts for Huly**

Replace contents of `src/linear/create-issue.ts`:

```typescript
import tracker, { IssuePriority } from '@hcengineering/tracker'
import tags from '@hcengineering/tags'
import core, { generateId, SortingOrder } from '@hcengineering/core'
import { makeRank } from '@hcengineering/rank'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:create-issue' })

export interface CreateIssueParams {
  userId: number
  title: string
  description?: string
  priority?: number
  projectId: string
  dueDate?: string
  labelIds?: string[]
  estimate?: number
}

export interface IssueResult {
  id: string
  identifier: string
  title: string
  url: string
}

export async function createIssue({
  userId,
  title,
  description,
  priority,
  projectId,
  dueDate,
  labelIds,
  estimate,
}: CreateIssueParams): Promise<IssueResult> {
  log.debug({ userId, title, projectId, priority, dueDate, estimate }, 'createIssue called')

  const client = await getHulyClient(userId)

  try {
    // Get project details
    const project = await client.findOne(tracker.class.Project, {
      _id: projectId as any,
    })

    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    // Generate issue ID
    const issueId = generateId()

    // Increment project sequence for issue number
    const incResult = await client.updateDoc(
      tracker.class.Project,
      core.space.Space,
      projectId as any,
      {
        $inc: { sequence: 1 },
      },
      true,
    )

    const sequence = (incResult as any).object.sequence

    // Get rank for ordering
    const lastIssue = await client.findOne(
      tracker.class.Issue,
      { space: projectId as any },
      { sort: { rank: SortingOrder.Descending } },
    )

    // Upload description if provided
    let descriptionRef = undefined
    if (description) {
      descriptionRef = await client.uploadMarkup(tracker.class.Issue, issueId, 'description', description, 'markdown')
    }

    // Map priority
    const mappedPriority = priority !== undefined ? mapPriority(priority) : IssuePriority.NoPriority

    // Create the issue
    await client.addCollection(
      tracker.class.Issue,
      projectId as any,
      projectId as any,
      tracker.class.Project,
      'issues',
      {
        title,
        description: descriptionRef,
        status: project.defaultIssueStatus,
        number: sequence,
        kind: tracker.taskTypes.Issue,
        identifier: `${project.identifier}-${sequence}`,
        priority: mappedPriority,
        assignee: null,
        component: null,
        estimation: estimate ?? 0,
        remainingTime: estimate ?? 0,
        reportedTime: 0,
        reports: 0,
        subIssues: 0,
        parents: [],
        childInfo: [],
        dueDate: dueDate ? new Date(dueDate).getTime() : null,
        rank: makeRank(lastIssue?.rank, undefined),
      },
      issueId,
    )

    // Handle labels if provided
    if (labelIds && labelIds.length > 0) {
      for (const labelId of labelIds) {
        await client.addCollection(tags.class.TagReference, projectId as any, issueId, tracker.class.Issue, 'labels', {
          title: '', // Will be looked up from TagElement
          color: 0,
          tag: labelId as any,
        })
      }
    }

    // Fetch created issue
    const issue = await client.findOne(tracker.class.Issue, { _id: issueId })

    if (!issue) {
      throw new Error('Issue was not created')
    }

    log.info({ issueId: issue._id, identifier: issue.identifier, title }, 'Issue created')

    // Construct URL with correct path format
    const url = `${process.env.HULY_URL}/workbench/${process.env.HULY_WORKSPACE}/tracker/${project.identifier}/${issue.identifier}`

    return {
      id: issue._id as string,
      identifier: issue.identifier,
      title: issue.title,
      url,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), title, projectId }, 'createIssue failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}

function mapPriority(linearPriority: number): IssuePriority {
  // Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  // Huly: NoPriority, Low, Medium, High, Urgent
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
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/linear/create-issue.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/linear/create-issue.ts tests/linear/create-issue.test.ts
git commit -m "feat(huly): rewrite create-issue for Huly API"
```

---

## Task 7-27: Rewrite Remaining 21 Linear Files

**Pattern for each file:**

### Task N: Rewrite [filename]

**Files:**

- Modify: `src/linear/[filename].ts`

**Steps:**

1. Import required Huly classes from `@hcengineering/tracker`, `@hcengineering/tags`
2. Replace `LinearClient` with `getHulyClient(userId)`
3. Transform Linear API calls to Huly API calls
4. Map data structures (Linear → Huly)
5. Update error handling to use `classifyHulyError`
6. Ensure client.close() in finally block
7. Run tests to verify
8. Commit

**Search-issues limitation:** Use `$like` filter for title search instead of full-text search:

```typescript
await client.findAll(tracker.class.Issue, {
  space: projectId as any,
  title: { $like: `%${query}%` },
})
```

**Files to rewrite:**

- [ ] `search-issues.ts` - Use `client.findAll()` with `$like` title filter
- [ ] `get-issue.ts` - Use `client.findOne()` with lookup
- [ ] `update-issue.ts` - Use `client.updateDoc()`
- [ ] `archive-issue.ts` - Use `client.updateDoc()` with archived status
- [ ] `list-projects.ts` - Use `client.findAll(tracker.class.Project)`
- [ ] `create-project.ts` - Use `client.createDoc()`
- [ ] `update-project.ts` - Use `client.updateDoc()`
- [ ] `archive-project.ts` - Use `client.updateDoc()` with archived flag
- [ ] `list-labels.ts` - Use `client.findAll(tags.class.TagElement)`
- [ ] `create-label.ts` - Use `client.createDoc(tags.class.TagElement)`
- [ ] `update-label.ts` - Use `client.updateDoc()` on TagElement
- [ ] `remove-label.ts` - Use `client.removeDoc()`
- [ ] `add-issue-label.ts` - Use `client.addCollection(tags.class.TagReference)`
- [ ] `remove-issue-label.ts` - Use `client.removeCollection(tags.class.TagReference)`
- [ ] `add-issue-comment.ts` - Use `client.addCollection()` with comment class
- [ ] `get-issue-comments.ts` - Use `client.findAll()` with attachedTo filter
- [ ] `update-issue-comment.ts` - Use `client.updateCollection()`
- [ ] `remove-issue-comment.ts` - Use `client.removeCollection()`
- [ ] `add-issue-relation.ts` - Use appropriate Huly relation mechanism
- [ ] `update-issue-relation.ts` - Update relation type
- [ ] `remove-issue-relation.ts` - Remove relation

---

## Task 28: Update Tool Factory and bot.ts

**Files:**

- Modify: `src/tools/index.ts`
- Modify: `src/bot.ts`

**Step 1: Update ToolConfig type**

Replace:

```typescript
type ToolConfig = { linearKey: string; linearTeamId: string }
```

With:

```typescript
type ToolConfig = { userId: number }
```

**Step 2: Update all tool makers**

Change each tool factory call from:

```typescript
create_issue: makeCreateIssueTool(linearKey, linearTeamId),
```

To:

```typescript
create_issue: makeCreateIssueTool(userId),
```

**Step 3: Update bot.ts checkRequiredConfig**

Modify: `src/bot.ts:65`
Change:

```typescript
const requiredKeys = ['openai_key', 'openai_base_url', 'openai_model', 'linear_key', 'linear_team_id'] as const
```

To:

```typescript
const requiredKeys = ['openai_key', 'openai_base_url', 'openai_model', 'huly_email', 'huly_password'] as const
```

**Step 4: Update SYSTEM_PROMPT**

Find and update any references to "Linear" in the system prompt to "Huly" or generic "issue tracking".

**Step 5: Update bot.ts to pass userId**

Modify: `src/bot.ts`

```typescript
const tools = makeTools({ userId: ctx.from.id })
```

**Step 6: Update individual tool files**

Change each tool file to accept `userId: number` instead of `linearKey: string, linearTeamId: string`.

**Step 7: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add src/tools/ src/bot.ts
git commit -m "feat(tools): update tool factory to pass userId for Huly auth"
```

---

## Task 29: Remove Linear SDK Dependency

**Files:**

- Modify: `package.json`

**Step 1: Remove Linear SDK**

Remove from dependencies:

```json
"@linear/sdk": "^XX.X.X"
```

**Step 2: Reinstall dependencies**

Run: `bun install`
Expected: Linear SDK removed, Huly packages remain

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: remove @linear/sdk, complete migration to Huly"
```

---

## Task 30: Rename Directory src/linear to src/huly

**Files:**

- Rename: `src/linear/` → `src/huly/`
- Rename: `tests/linear/` → `tests/huly/`

**Step 1: Rename directories**

```bash
git mv src/linear src/huly
git mv tests/linear tests/huly
```

**Step 2: Update all imports**

Search and replace across codebase:

- `'../linear/'` → `'../huly/'`
- `'./linear/'` → `'./huly/'`
- `'../../linear/'` → `'../../huly/'`

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename src/linear to src/huly"
```

---

## Task 31: Update errors.ts Naming

**Files:**

- Modify: `src/errors.ts`
- Modify: All files importing from errors.ts

**Step 1: Rename LinearError to HulyError**

In `src/errors.ts`:

- Rename `LinearError` → `HulyError`
- Rename `linearError` → `hulyError`
- Rename `getLinearMessage` → `getHulyMessage`

**Step 2: Update error messages**

Change user-facing messages from Linear-specific to Huly/generic:

- "LINEAR_TEAM_ID" → "Huly project configuration"
- "Linear API" → "Huly API"
- "issue" and "project" terminology remains the same

**Step 3: Update all imports**

Search and replace across codebase:

- `LinearError` → `HulyError`
- `linearError` → `hulyError`
- `getLinearMessage` → `getHulyMessage`

**Step 4: Update error classifier**

Modify `src/linear/classify-error.ts` to use renamed exports.

**Step 5: Run tests**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/errors.ts src/linear/
git commit -m "refactor(errors): rename LinearError to HulyError"
```

---

## Task 32: Add Environment Variable Documentation

**Files:**

- Modify: `.env.example`

**Step 1: Update env example**

Replace Linear vars with Huly vars:

```
# Huly Configuration (Required)
HULY_URL=https://huly.app
HULY_WORKSPACE=your-workspace

# User-specific config (set via /set command):
# huly_email=user@example.com
# huly_password=secret
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: update .env.example with Huly configuration"
```

---

## Task 33: Final Integration Test

**Files:**

- All files

**Step 1: Run linter**

Run: `bun run lint`
Expected: No errors

**Step 2: Run formatter check**

Run: `bun run format`
Expected: No changes needed

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 4: Manual smoke test**

If possible, run the bot locally with Huly credentials and verify:

- `/set huly_email` works
- `/set huly_password` works
- Creating an issue works
- Searching issues works
- Issue URL resolves correctly in browser

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Linear to Huly migration"
```

---

## Summary

This migration replaces Linear SDK with Huly API Client while maintaining:

- All 22 tool interfaces unchanged
- Same Telegram bot UX
- Per-user project isolation via auto-created projects
- Multi-project support for users who need it

**Risk Mitigation:**

- Keep Linear branch as backup until Huly is verified in production
- Each task is testable independently
- Gradual rollout possible by feature flag

**Post-Migration:**

- Update README.md with Huly setup instructions
- Archive Linear-related documentation
- Monitor error logs for Huly-specific issues

## Key Corrections Applied

1. **GitHub Packages auth** - Added Task 0 for .npmrc configuration
2. **WebSocket factory** - Added NodeWebSocketFactory to client options
3. **Error handling** - Uses HulyApiError wrapper with existing AppError factories
4. **Tags import** - Added missing tags import in create-issue.ts
5. **Task dependency** - Added @hcengineering/task to dependencies
6. **URL format** - Fixed to path-based: `/tracker/{project}/{issue}`
7. **Search limitation** - Documented $like filter for title search (not full-text)
8. **bot.ts updates** - Added checkRequiredConfig and SYSTEM_PROMPT updates to Task 28
9. **errors.ts naming** - Added Task 31 to rename LinearError → HulyError
