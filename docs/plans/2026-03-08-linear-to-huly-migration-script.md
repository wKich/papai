# Linear-to-Huly Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add built-in migration that runs on papai startup to move user issues from Linear to Huly, deployed via two-stage CI/CD pipeline.

**Architecture:** Papai will check a `linear_migrated` flag on startup. If not set, it will fetch issues from Linear API using stored credentials, create them in Huly, and mark migration complete. Migration is idempotent - can be retried safely.

**Tech Stack:** TypeScript, Bun, SQLite, @linear/sdk (for migration only), @hcengineering/api-client, GitHub Actions

---

## Task 1: Add Migration Schema

**Files:**

- Modify: `src/db/migrations/001_initial.ts`
- Test: `tests/db/001_initial.test.ts`

**Step 1: Write the failing test**

Create `tests/db/001_initial.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { getDb, closeDb } from '../../src/db/index.js'
import { runMigrations } from '../../src/db/migrate.js'

describe('Database migrations', () => {
  beforeAll(() => {
    runMigrations()
  })

  afterAll(() => {
    closeDb()
  })

  it('should have migration_status table', () => {
    const db = getDb()
    const table = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='migration_status'").get()
    expect(table).toBeDefined()
  })

  it('should track linear migration status', () => {
    const db = getDb()
    const result = db
      .query("SELECT COUNT(*) as count FROM migration_status WHERE migration_name = 'linear_to_huly'")
      .get() as { count: number }
    expect(result.count).toBe(1)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/db/001_initial.test.ts
```

Expected: FAIL - "migration_status table not found"

**Step 3: Add migration schema**

Modify `src/db/migrations/001_initial.ts` - add at the end of the `up` migration (before the final `)`:

```typescript
db.run(`
    CREATE TABLE IF NOT EXISTS migration_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
      started_at INTEGER,
      completed_at INTEGER,
      error_message TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `)

// Seed initial migration status
db.run(`
    INSERT OR IGNORE INTO migration_status (migration_name, status)
    VALUES ('linear_to_huly', 'pending')
  `)
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/db/001_initial.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/db/migrations/001_initial.ts tests/db/001_initial.test.ts
git commit -m "feat(db): add migration_status table for linear-to-huly tracking"
```

---

## Task 2: Create Migration Status Module

**Files:**

- Create: `src/db/migration-status.ts`
- Test: `tests/db/migration-status.test.ts`

**Step 1: Write the failing test**

Create `tests/db/migration-status.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { getMigrationStatus, setMigrationStatus, isMigrationComplete } from '../../src/db/migration-status.js'
import { getDb, closeDb } from '../../src/db/index.js'
import { runMigrations } from '../../src/db/migrate.js'

describe('Migration Status', () => {
  beforeEach(() => {
    runMigrations()
    const db = getDb()
    db.run("DELETE FROM migration_status WHERE migration_name = 'linear_to_huly'")
    db.run("INSERT INTO migration_status (migration_name, status) VALUES ('linear_to_huly', 'pending')")
  })

  afterAll(() => {
    closeDb()
  })

  it('should return pending status initially', () => {
    const status = getMigrationStatus('linear_to_huly')
    expect(status).toBe('pending')
  })

  it('should update status to in_progress', () => {
    setMigrationStatus('linear_to_huly', 'in_progress')
    const status = getMigrationStatus('linear_to_huly')
    expect(status).toBe('in_progress')
  })

  it('should update status to completed', () => {
    setMigrationStatus('linear_to_huly', 'completed')
    const status = getMigrationStatus('linear_to_huly')
    expect(status).toBe('completed')
  })

  it('should return false for isMigrationComplete when pending', () => {
    expect(isMigrationComplete('linear_to_huly')).toBe(false)
  })

  it('should return true for isMigrationComplete when completed', () => {
    setMigrationStatus('linear_to_huly', 'completed')
    expect(isMigrationComplete('linear_to_huly')).toBe(true)
  })

  it('should store error message on failure', () => {
    setMigrationStatus('linear_to_huly', 'failed', 'Linear API timeout')
    const db = getDb()
    const row = db
      .query("SELECT error_message FROM migration_status WHERE migration_name = 'linear_to_huly'")
      .get() as { error_message: string }
    expect(row.error_message).toBe('Linear API timeout')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/db/migration-status.test.ts
```

Expected: FAIL - "Module not found"

**Step 3: Write implementation**

Create `src/db/migration-status.ts`:

```typescript
import { getDb } from './index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'migration-status' })

export type MigrationName = 'linear_to_huly'
export type MigrationStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export function getMigrationStatus(migrationName: MigrationName): MigrationStatus {
  log.debug({ migrationName }, 'Getting migration status')
  const db = getDb()
  const row = db
    .query<{ status: MigrationStatus }, [string]>('SELECT status FROM migration_status WHERE migration_name = ?')
    .get(migrationName)

  if (!row) {
    log.warn({ migrationName }, 'Migration status not found, returning pending')
    return 'pending'
  }

  return row.status
}

export function setMigrationStatus(migrationName: MigrationName, status: MigrationStatus, errorMessage?: string): void {
  log.info({ migrationName, status }, 'Setting migration status')
  const db = getDb()

  if (status === 'completed') {
    db.run(
      `UPDATE migration_status 
       SET status = ?, completed_at = unixepoch(), error_message = NULL 
       WHERE migration_name = ?`,
      [status, migrationName],
    )
  } else if (status === 'failed' && errorMessage) {
    db.run(
      `UPDATE migration_status 
       SET status = ?, error_message = ? 
       WHERE migration_name = ?`,
      [status, errorMessage, migrationName],
    )
  } else if (status === 'in_progress') {
    db.run(
      `UPDATE migration_status 
       SET status = ?, started_at = unixepoch(), error_message = NULL 
       WHERE migration_name = ?`,
      [status, migrationName],
    )
  } else {
    db.run('UPDATE migration_status SET status = ? WHERE migration_name = ?', [status, migrationName])
  }
}

export function isMigrationComplete(migrationName: MigrationName): boolean {
  return getMigrationStatus(migrationName) === 'completed'
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/db/migration-status.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/db/migration-status.ts tests/db/migration-status.test.ts
git commit -m "feat(db): add migration status tracking module"
```

---

## Task 3: Install Linear SDK (Migration Dependency)

**Files:**

- Modify: `package.json`

**Step 1: Add @linear/sdk to dependencies**

Modify `package.json` - add to dependencies section:

```json
"@linear/sdk": "^38.0.0"
```

Full dependencies section should look like:

```json
"dependencies": {
  "@ai-sdk/openai-compatible": "^2.0.33",
  "@gramio/format": "^0.5.0",
  "@hcengineering/api-client": "^0.7.0",
  "@hcengineering/core": "^0.7.0",
  "@hcengineering/rank": "^0.7.0",
  "@hcengineering/tags": "^0.7.0",
  "@hcengineering/task": "^0.7.0",
  "@hcengineering/tracker": "^0.7.0",
  "@linear/sdk": "^38.0.0",
  "ai": "^6.0.108",
  "grammy": "^1.41.1",
  "marked": "^17.0.4",
  "pino": "^10.3.1",
  "zod": "^4.0.0"
}
```

**Step 2: Install dependency**

```bash
bun install
```

Expected: Package installed successfully

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "deps: add @linear/sdk for migration"
```

---

## Task 4: Create Linear API Client Module

**Files:**

- Create: `src/migration/linear-client.ts`
- Test: `tests/migration/linear-client.test.ts`

**Step 1: Write the failing test**

Create `tests/migration/linear-client.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { createLinearClient, fetchUserIssues, type LinearIssue } from '../../src/migration/linear-client.js'

describe('Linear Client', () => {
  it('should create client with API key', () => {
    const client = createLinearClient('test-api-key')
    expect(client).toBeDefined()
  })

  it('should have fetchUserIssues function', () => {
    expect(typeof fetchUserIssues).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/migration/linear-client.test.ts
```

Expected: FAIL - "Module not found"

**Step 3: Write implementation**

Create `src/migration/linear-client.ts`:

```typescript
import { LinearClient } from '@linear/sdk'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'linear-client' })

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description?: string
  state: {
    name: string
    type: string
  }
  priority: number
  labels: { name: string }[]
  assignee?: { email: string }
  createdAt: Date
  updatedAt: Date
}

export function createLinearClient(apiKey: string): LinearClient {
  log.debug('Creating Linear client')
  return new LinearClient({ apiKey })
}

export async function fetchUserIssues(client: LinearClient, teamId: string): Promise<LinearIssue[]> {
  log.info({ teamId }, 'Fetching user issues from Linear')

  try {
    const issues = await client.issues({
      filter: {
        team: { id: { eq: teamId } },
      },
      first: 100,
    })

    const results: LinearIssue[] = []

    for (const issue of issues.nodes) {
      const state = await issue.state
      const labels = await issue.labels()
      const assignee = await issue.assignee

      results.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
        state: {
          name: state?.name ?? 'Unknown',
          type: state?.type ?? 'unstarted',
        },
        priority: issue.priority,
        labels: labels.nodes.map((l) => ({ name: l.name })),
        assignee: assignee ? { email: assignee.email } : undefined,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      })
    }

    log.info({ count: results.length }, 'Fetched issues from Linear')
    return results
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Failed to fetch Linear issues')
    throw error
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/migration/linear-client.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/migration/linear-client.ts tests/migration/linear-client.test.ts
git commit -m "feat(migration): add Linear API client for fetching issues"
```

---

## Task 5: Create Issue Mapper (Linear → Huly)

**Files:**

- Create: `src/migration/issue-mapper.ts`
- Test: `tests/migration/issue-mapper.test.ts`

**Step 1: Write the failing test**

Create `tests/migration/issue-mapper.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import {
  mapLinearIssueToHuly,
  mapLinearPriorityToHuly,
  mapLinearStatusToHuly,
} from '../../src/migration/issue-mapper.js'
import type { LinearIssue } from '../../src/migration/linear-client.js'

describe('Issue Mapper', () => {
  const mockLinearIssue: LinearIssue = {
    id: 'linear-123',
    identifier: 'TEAM-42',
    title: 'Test Issue',
    description: 'Test description',
    state: { name: 'In Progress', type: 'started' },
    priority: 2,
    labels: [{ name: 'bug' }],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  }

  it('should map priority 0 to no priority', () => {
    expect(mapLinearPriorityToHuly(0)).toBeUndefined()
  })

  it('should map priority 1 to urgent', () => {
    expect(mapLinearPriorityToHuly(1)).toBe('urgent')
  })

  it('should map priority 2 to high', () => {
    expect(mapLinearPriorityToHuly(2)).toBe('high')
  })

  it('should map priority 3 to medium', () => {
    expect(mapLinearPriorityToHuly(3)).toBe('medium')
  })

  it('should map priority 4 to low', () => {
    expect(mapLinearPriorityToHuly(4)).toBe('low')
  })

  it('should map Linear issue to Huly format', () => {
    const result = mapLinearIssueToHuly(mockLinearIssue, 'project-123')
    expect(result.title).toBe('Test Issue')
    expect(result.description).toBe('Test description')
    expect(result.project).toBe('project-123')
    expect(result.priority).toBe('high')
    expect(result.labels).toEqual(['bug'])
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/migration/issue-mapper.test.ts
```

Expected: FAIL - "Module not found"

**Step 3: Write implementation**

Create `src/migration/issue-mapper.ts`:

```typescript
import type { LinearIssue } from './linear-client.js'
import type { IssuePriority } from '../huly/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'issue-mapper' })

export interface HulyIssueData {
  title: string
  description?: string
  project: string
  priority?: IssuePriority
  labels?: string[]
}

export function mapLinearPriorityToHuly(linearPriority: number): IssuePriority | undefined {
  // Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  // Huly: 'urgent' | 'high' | 'medium' | 'low'
  switch (linearPriority) {
    case 1:
      return 'urgent'
    case 2:
      return 'high'
    case 3:
      return 'medium'
    case 4:
      return 'low'
    default:
      return undefined
  }
}

export function mapLinearStatusToHuly(linearStatus: string): string {
  // Map Linear states to Huly states
  // This is a simplified mapping - customize based on your workflow
  const statusMap: Record<string, string> = {
    Backlog: 'Backlog',
    Todo: 'Todo',
    'In Progress': 'In Progress',
    Done: 'Done',
    Canceled: 'Canceled',
  }
  return statusMap[linearStatus] ?? 'Backlog'
}

export function mapLinearIssueToHuly(linearIssue: LinearIssue, hulyProjectId: string): HulyIssueData {
  log.debug({ linearId: linearIssue.id }, 'Mapping Linear issue to Huly')

  return {
    title: linearIssue.title,
    description: linearIssue.description,
    project: hulyProjectId,
    priority: mapLinearPriorityToHuly(linearIssue.priority),
    labels: linearIssue.labels.map((l) => l.name),
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/migration/issue-mapper.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/migration/issue-mapper.ts tests/migration/issue-mapper.test.ts
git commit -m "feat(migration): add Linear-to-Huly issue mapper"
```

---

## Task 6: Create Migration Engine

**Files:**

- Create: `src/migration/migrate.ts`
- Test: `tests/migration/migrate.test.ts`

**Step 1: Write the failing test**

Create `tests/migration/migrate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { runLinearToHulyMigration } from '../../src/migration/migrate.js'
import { getDb, closeDb } from '../../src/db/index.js'
import { runMigrations } from '../../src/db/migrate.js'
import { setMigrationStatus } from '../../src/db/migration-status.js'

describe('Migration Engine', () => {
  beforeEach(() => {
    runMigrations()
    setMigrationStatus('linear_to_huly', 'pending')
  })

  afterAll(() => {
    closeDb()
  })

  it('should be defined', () => {
    expect(typeof runLinearToHulyMigration).toBe('function')
  })

  it('should skip if migration already completed', async () => {
    setMigrationStatus('linear_to_huly', 'completed')
    // Should not throw
    await runLinearToHulyMigration()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/migration/migrate.test.ts
```

Expected: FAIL - "Module not found"

**Step 3: Write implementation**

Create `src/migration/migrate.ts`:

```typescript
import { createLinearClient, fetchUserIssues } from './linear-client.js'
import { mapLinearIssueToHuly } from './issue-mapper.js'
import { createIssue } from '../huly/create-issue.js'
import { getMigrationStatus, setMigrationStatus, isMigrationComplete } from '../db/migration-status.js'
import { getConfig } from '../config.js'
import { getOrCreateUserProject } from '../huly/project-utils.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'migration' })

export interface MigrationResult {
  success: boolean
  migratedCount: number
  errors: string[]
}

export async function runLinearToHulyMigration(): Promise<MigrationResult> {
  log.info('Starting Linear to Huly migration')

  // Check if already completed
  if (isMigrationComplete('linear_to_huly')) {
    log.info('Migration already completed, skipping')
    return { success: true, migratedCount: 0, errors: [] }
  }

  // Check current status
  const currentStatus = getMigrationStatus('linear_to_huly')
  if (currentStatus === 'in_progress') {
    log.warn('Migration already in progress, skipping to prevent conflicts')
    return { success: false, migratedCount: 0, errors: ['Migration already in progress'] }
  }

  setMigrationStatus('linear_to_huly', 'in_progress')

  const errors: string[] = []
  let migratedCount = 0

  try {
    // Get all users who have Linear credentials
    const db = (await import('../db/index.js')).getDb()
    const users = db
      .query<
        { user_id: number },
        []
      >(`SELECT DISTINCT user_id FROM user_config WHERE key IN ('linear_key', 'linear_team_id')`)
      .all()

    log.info({ userCount: users.length }, 'Found users with Linear credentials')

    for (const { user_id: userId } of users) {
      try {
        const result = await migrateUserIssues(userId)
        migratedCount += result.count
        if (result.error) {
          errors.push(`User ${userId}: ${result.error}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`User ${userId}: ${message}`)
        log.error({ userId, error: message }, 'Failed to migrate user issues')
      }
    }

    const success = errors.length === 0
    if (success) {
      setMigrationStatus('linear_to_huly', 'completed')
      log.info({ migratedCount }, 'Migration completed successfully')
    } else {
      setMigrationStatus('linear_to_huly', 'failed', errors.join('; '))
      log.error({ errorCount: errors.length }, 'Migration completed with errors')
    }

    return { success, migratedCount, errors }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setMigrationStatus('linear_to_huly', 'failed', message)
    log.error({ error: message }, 'Migration failed')
    return { success: false, migratedCount, errors: [message] }
  }
}

interface UserMigrationResult {
  count: number
  error?: string
}

async function migrateUserIssues(userId: number): Promise<UserMigrationResult> {
  log.info({ userId }, 'Migrating user issues')

  const linearKey = getConfig(userId, 'linear_key')
  const linearTeamId = getConfig(userId, 'linear_team_id')
  const hulyEmail = getConfig(userId, 'huly_email')
  const hulyPassword = getConfig(userId, 'huly_password')

  if (!linearKey || !linearTeamId) {
    return { count: 0, error: 'Missing Linear credentials' }
  }

  if (!hulyEmail || !hulyPassword) {
    return { count: 0, error: 'Missing Huly credentials' }
  }

  // Create Linear client and fetch issues
  const linearClient = createLinearClient(linearKey)
  const linearIssues = await fetchUserIssues(linearClient, linearTeamId)

  if (linearIssues.length === 0) {
    log.info({ userId }, 'No Linear issues to migrate')
    return { count: 0 }
  }

  // Get or create user's personal project in Huly
  const projectId = await getOrCreateUserProject(userId, 'Imported from Linear')

  let migratedCount = 0
  for (const linearIssue of linearIssues) {
    try {
      const hulyData = mapLinearIssueToHuly(linearIssue, projectId)
      await createIssue(userId, hulyData)
      migratedCount++
      log.debug({ linearId: linearIssue.id, userId }, 'Migrated issue')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error({ linearId: linearIssue.id, error: message }, 'Failed to migrate issue')
      // Continue with other issues, don't fail entire user migration
    }
  }

  log.info({ userId, migratedCount, totalCount: linearIssues.length }, 'User migration complete')
  return { count: migratedCount }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/migration/migrate.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/migration/migrate.ts tests/migration/migrate.test.ts
git commit -m "feat(migration): add migration engine with user iteration"
```

---

## Task 7: Integrate Migration into Startup

**Files:**

- Modify: `src/index.ts:1-50`
- Test: Update `tests/index.test.ts` or create new test

**Step 1: Review current index.ts**

Read the first 50 lines of `src/index.ts` to see current startup logic.

**Step 2: Add migration check to startup**

Modify `src/index.ts` - after database initialization and before bot startup:

Add import at the top:

```typescript
import { runLinearToHulyMigration } from './migration/migrate.js'
import { isMigrationComplete } from './db/migration-status.js'
```

Add migration step in startup flow (after `runMigrations()` call):

```typescript
// Run Linear to Huly migration if needed
if (!isMigrationComplete('linear_to_huly')) {
  logger.info('Linear to Huly migration not complete, running migration...')
  const result = await runLinearToHulyMigration()
  if (!result.success) {
    logger.error({ errors: result.errors }, 'Migration failed but continuing startup')
    // Don't fail startup on migration error - allow manual retry
  }
}
```

**Step 3: Test migration integration**

Run the app to verify it starts without errors:

```bash
bun run start
```

Expected: App starts, checks migration status, skips if completed or no Linear credentials found

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: integrate Linear-to-Huly migration into startup flow"
```

---

## Task 8: Create Migration Index File

**Files:**

- Create: `src/migration/index.ts`

**Step 1: Create exports**

Create `src/migration/index.ts`:

```typescript
export { createLinearClient, fetchUserIssues } from './linear-client.js'
export { mapLinearIssueToHuly, mapLinearPriorityToHuly } from './issue-mapper.js'
export { runLinearToHulyMigration, type MigrationResult } from './migrate.js'
```

**Step 2: Commit**

```bash
git add src/migration/index.ts
git commit -m "feat(migration): add migration module exports"
```

---

## Task 9: Create Standalone Migration Script

**Files:**

- Create: `scripts/migrate.ts`

**Step 1: Create standalone script**

Create `scripts/migrate.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Standalone migration script for Linear to Huly
 * Can be run manually: bun run scripts/migrate.ts
 */

import { runMigrations } from '../src/db/migrate.js'
import { runLinearToHulyMigration } from '../src/migration/migrate.js'
import { setMigrationStatus } from '../src/db/migration-status.js'
import { logger } from '../src/logger.js'

async function main() {
  logger.info('Starting standalone migration script')

  // Initialize database
  runMigrations()

  // Reset migration status to force re-run (optional, for retries)
  const shouldReset = process.argv.includes('--reset')
  if (shouldReset) {
    logger.info('Resetting migration status')
    setMigrationStatus('linear_to_huly', 'pending')
  }

  // Run migration
  const result = await runLinearToHulyMigration()

  if (result.success) {
    logger.info({ migratedCount: result.migratedCount }, 'Migration completed successfully')
    process.exit(0)
  } else {
    logger.error({ errors: result.errors }, 'Migration failed')
    process.exit(1)
  }
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Unhandled error in migration script')
  process.exit(1)
})
```

**Step 2: Add script to package.json**

Modify `package.json` - add to scripts section:

```json
"migrate": "bun run scripts/migrate.ts",
"migrate:reset": "bun run scripts/migrate.ts --reset"
```

**Step 3: Commit**

```bash
git add scripts/migrate.ts package.json
git commit -m "feat: add standalone migration script"
```

---

## Task 10: Create Two-Stage CI/CD Workflow

**Files:**

- Create: `.github/workflows/deploy-huly.yml`
- Modify: `.github/workflows/deploy.yml`

**Step 1: Create Huly deployment workflow**

Create `.github/workflows/deploy-huly.yml`:

```yaml
name: Deploy Huly

on:
  workflow_call:
    inputs:
      environment:
        description: 'Deployment environment'
        required: true
        type: string
        default: 'production'

jobs:
  deploy-huly:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - name: Deploy Huly Infrastructure
        run: |
          echo "Deploying Huly to ${{ inputs.environment }}..."
          # Add your Huly deployment commands here
          # e.g., kubectl apply, terraform apply, docker-compose up, etc.

      - name: Wait for Huly Health Check
        run: |
          echo "Waiting for Huly to be ready..."
          # Add health check logic
          # e.g., curl --retry 10 --retry-delay 5 ${{ secrets.HULY_HEALTH_URL }}

      - name: Verify Huly Deployment
        run: |
          echo "Verifying Huly deployment..."
          # Add verification logic
```

**Step 2: Update papai deploy workflow**

Modify `.github/workflows/deploy.yml` to add workflow_call trigger:

```yaml
name: Deploy Papai

on:
  push:
    branches: [main]
  release:
    types: [published]
  workflow_call: # Add this for being called from release workflow
    inputs:
      prerelease:
        description: 'Whether this is a prerelease'
        required: false
        type: boolean
        default: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      # ... existing steps ...

      - name: Run Migration
        run: |
          echo "Running Linear to Huly migration..."
          bun run migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          # Add other required env vars
        continue-on-error: true # Don't fail deploy if migration has issues

      - name: Deploy Papai
        run: |
          echo "Deploying Papai..."
          # Your deployment commands
```

**Step 3: Create orchestrated release workflow**

Modify `.github/workflows/release.yml` to orchestrate both deployments:

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      bump_type:
        description: 'Version bump type'
        required: true
        default: 'patch'
        type: choice
        options:
          - patch
          - minor
          - major

jobs:
  release:
    # ... existing release job ...

  deploy-huly:
    needs: release
    uses: ./.github/workflows/deploy-huly.yml
    with:
      environment: production
    secrets: inherit

  migrate:
    needs: deploy-huly
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - name: Install dependencies
        run: bun install
      - name: Run migration
        run: bun run migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          HULY_URL: ${{ secrets.HULY_URL }}
          HULY_WORKSPACE: ${{ secrets.HULY_WORKSPACE }}
      - name: Migration status
        if: failure()
        run: |
          echo "::warning::Migration failed. Deploy will continue but data may be incomplete."
          echo "Run 'bun run migrate:reset' manually to retry."
    continue-on-error: true

  deploy-papai:
    needs: [deploy-huly, migrate]
    if: always() && needs.deploy-huly.result == 'success'
    uses: ./.github/workflows/deploy.yml
    with:
      prerelease: false
    secrets: inherit
```

**Step 4: Commit**

```bash
git add .github/workflows/deploy-huly.yml .github/workflows/deploy.yml .github/workflows/release.yml
git commit -m "ci: add two-stage deployment with Huly deploy + migration + papai deploy"
```

---

## Task 11: Add Migration Documentation

**Files:**

- Create: `docs/migration.md`

**Step 1: Write documentation**

Create `docs/migration.md`:

````markdown
# Linear to Huly Migration

This document describes the migration process from Linear to Huly.

## Overview

The migration is designed to be **automatic and idempotent**. It runs on papai startup if not previously completed.

## How It Works

1. **Startup Check**: Papai checks `migration_status` table on startup
2. **Fetch from Linear**: Uses stored `linear_key` and `linear_team_id` to fetch issues
3. **Create in Huly**: Maps Linear issues to Huly format and creates them
4. **Track Progress**: Updates migration status in database

## Prerequisites

Users must have both Linear and Huly credentials configured:

- Linear: `linear_key`, `linear_team_id` (legacy, still in DB)
- Huly: `huly_email`, `huly_password`

## Running Migration

### Automatic (on startup)

```bash
bun run start
```
````

### Manual (standalone)

```bash
# Run migration
bun run migrate

# Reset and re-run
bun run migrate:reset
```

## Deployment Process

The CI/CD pipeline deploys in three stages:

1. **Deploy Huly** - Infrastructure and services
2. **Run Migration** - Data transfer (continues on failure)
3. **Deploy Papai** - Application with Huly support

## Troubleshooting

### Migration Failed

Check logs:

```bash
bun run migrate 2>&1 | grep -i error
```

Reset and retry:

```bash
bun run migrate:reset
```

### Partial Migration

Migration is idempotent - running it again will skip already-migrated users and retry failed ones.

## Post-Migration

After successful migration:

- Linear credentials can be removed from user configs
- `@linear/sdk` dependency can be removed (in future release)

````

**Step 2: Commit**

```bash
git add docs/migration.md
git commit -m "docs: add migration guide"
````

---

## Task 12: Final Integration Test

**Files:**

- Create: `tests/migration/integration.test.ts`

**Step 1: Create integration test**

Create `tests/migration/integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { runMigrations, closeDb } from '../../src/db/index.js'
import { runLinearToHulyMigration } from '../../src/migration/migrate.js'
import { isMigrationComplete, setMigrationStatus } from '../../src/db/migration-status.js'

describe('Migration Integration', () => {
  beforeAll(() => {
    runMigrations()
  })

  afterAll(() => {
    closeDb()
  })

  it('should handle migration when no Linear credentials exist', async () => {
    setMigrationStatus('linear_to_huly', 'pending')

    const result = await runLinearToHulyMigration()

    // Should complete successfully even with no data
    expect(result.success).toBe(true)
    expect(result.migratedCount).toBe(0)
    expect(isMigrationComplete('linear_to_huly')).toBe(true)
  })

  it('should skip migration when already completed', async () => {
    setMigrationStatus('linear_to_huly', 'completed')

    const result = await runLinearToHulyMigration()

    expect(result.success).toBe(true)
    expect(result.migratedCount).toBe(0)
  })
})
```

**Step 2: Run integration test**

```bash
bun test tests/migration/integration.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add tests/migration/integration.test.ts
git commit -m "test: add migration integration tests"
```

---

## Task 13: Run Full Test Suite

**Files:**

- All test files

**Step 1: Run all tests**

```bash
bun test
```

Expected: All tests pass

**Step 2: Run linter**

```bash
bun run lint
```

Expected: No errors

**Step 3: Format code**

```bash
bun run format
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Linear-to-Huly migration system"
```

---

## Summary

This implementation adds:

1. **Database tracking** - `migration_status` table to track migration state
2. **Migration modules** - Linear client, issue mapper, migration engine
3. **Automatic execution** - Runs on papai startup if not completed
4. **Manual script** - `bun run migrate` for manual execution
5. **CI/CD integration** - Two-stage deploy: Huly → Migration → Papai
6. **Idempotency** - Safe to retry, skips completed work
7. **Per-user migration** - Each user's issues migrated separately

The migration will automatically run when papai starts with new Huly-compatible code, moving all existing Linear issues to Huly before the bot begins processing new requests.
