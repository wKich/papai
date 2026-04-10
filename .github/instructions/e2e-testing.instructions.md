---
applyTo: 'tests/e2e/**'
---

# E2E Testing Conventions

E2E tests run against a real Kaneo instance in Docker. Global setup is handled automatically by `bun-test-setup.ts` — individual test files only need test logic.

## Test Structure

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'

describe('Feature', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()
  })

  test('does something', async () => {
    const project = await testClient.createTestProject()
    const task = await createTask(kaneoConfig, { title: 'Test', projectId: project.id })
    testClient.trackTask(task.id) // Track for automatic cleanup
    expect(task.title).toBe('Test')
  })
})
```

## Rules

- Use `KaneoTestClient` from `./kaneo-test-client.ts` for resource management
- **Always** call `testClient.trackTask(taskId)` for tasks created outside the test client
- Clean up in `beforeEach` via `testClient.cleanup()` — not `afterEach`
- No `beforeAll`/`afterAll` needed — global setup handles Docker lifecycle
- Do NOT mock anything — these tests hit real APIs
- E2E tests are excluded from `bun test` via `bunfig.toml` — run with `bun test:e2e`

## Planning New E2E Coverage

- Before proposing or writing a new E2E plan, read `docs/superpowers/e2e-planning-workflow.md`.
- Start new plan files from `docs/superpowers/templates/e2e-test-plan-template.md`.
- Treat the existing Docker-backed Kaneo suite as **Tier 1: Provider-Real E2E**.
- Prefer the smallest realism tier that proves the boundary; do not inflate Tier 2-4 coverage when Tier 1 or cheaper tests are sufficient.
