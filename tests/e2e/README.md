# E2E Tests

End-to-end tests for papai that test against a real Kaneo API instance.

## Overview

These tests verify the integration between papai and the Kaneo API by:

1. Starting a Kaneo server via Docker Compose
2. Provisioning a test user and workspace
3. Running tests against the live API
4. Cleaning up resources and stopping the server

## Running E2E Tests

### Prerequisites

- Docker and Docker Compose installed
- `.env` file configured with required variables:
  - `KANEO_POSTGRES_PASSWORD`
  - `KANEO_AUTH_SECRET`
  - `KANEO_CLIENT_URL`

### Run Tests

```bash
# Run all E2E tests (automatically starts/stops Kaneo server)
bun test tests/e2e/

# Run specific E2E test file
bun test tests/e2e/task-lifecycle.test.ts
```

## How It Works

### Automatic Docker Lifecycle

The E2E setup automatically manages the Kaneo server:

1. **Before tests**: `setupE2EEnvironment()` starts the Docker containers and waits for the server to be healthy
2. **During tests**: Tests run against the live Kaneo API at `localhost:11337`
3. **After tests**: `teardownE2EEnvironment()` stops and removes the Docker containers

### Docker Services

The following services are started via `docker-compose.yml` + `docker-compose.test.yml`:

- `kaneo-postgres`: PostgreSQL database (port 5432 internally)
- `kaneo-api`: Kaneo API server (exposed on port 11337)
- `kaneo-db-fix`: One-shot migration fix service

### Configuration

#### Environment Variables

| Variable             | Description                     | Default                  |
| -------------------- | ------------------------------- | ------------------------ |
| `E2E_KANEO_URL`      | URL for E2E tests to connect to | `http://localhost:11337` |
| `KANEO_INTERNAL_URL` | Internal Docker URL             | Same as `E2E_KANEO_URL`  |
| `KANEO_CLIENT_URL`   | Public URL for auth requests    | Same as base URL         |

## Test Structure

Each E2E test file follows this pattern:

```typescript
import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { setupE2EEnvironment, teardownE2EEnvironment } from './setup.js'

describe('E2E: Feature Name', () => {
  beforeAll(async () => {
    await setupE2EEnvironment()
    // ... create test client
  })

  afterAll(async () => {
    await teardownE2EEnvironment()
  })

  beforeEach(async () => {
    // Clean up from previous test
    await testClient.cleanup()
  })

  test('specific test case', async () => {
    // Test implementation
  })
})
```

## Test Client

Use `KaneoTestClient` from `kaneo-test-client.ts` for resource management:

```typescript
import { createTestClient } from './kaneo-test-client.js'

const testClient = createTestClient()
const kaneoConfig = testClient.getKaneoConfig()
const workspaceId = testClient.getWorkspaceId()

// Create resources
const project = await testClient.createTestProject('Test Project')

// Track resources for cleanup
testClient.trackTask(task.id)
testClient.trackProject(project.id)

// Cleanup in beforeEach
await testClient.cleanup()
```

## Cleanup

The test runner handles cleanup automatically:

1. **Test-level**: `beforeEach` cleans up resources created by the previous test
2. **Suite-level**: `afterAll` tears down the entire environment including Docker containers
3. **Signal handling**: SIGINT/SIGTERM are caught to ensure cleanup runs even on interruption

## Troubleshooting

### Server not starting

Check Docker logs:

```bash
docker-compose -f docker-compose.yml -f docker-compose.test.yml logs kaneo-api
```

### Port already in use

If port 11337 is already in use, you can change it via `KANEO_API_PORT`:

```bash
KANEO_API_PORT=11338 bun test tests/e2e/
```

### Tests failing with connection refused

The server might not be ready. Check that all services are healthy:

```bash
docker-compose -f docker-compose.yml -f docker-compose.test.yml ps
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   E2E Tests     │────▶│  Docker Lifecycle │────▶│  Kaneo Server   │
│  (Bun test)     │     │   (setup.ts)     │     │  (Docker)       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │                        │
         │              ┌────────┴────────┐              │
         │              │  Start: docker-  │              │
         │              │  compose up -d  │              │
         │              └────────┬────────┘              │
         │                       │                        │
         │              ┌────────┴────────┐              │
         │              │  Wait: Health    │              │
         │              │  check loop      │              │
         │              └────────┬────────┘              │
         │                       │                        │
         │              ┌────────┴────────┐              │
         │              │  Stop: docker-  │              │
         │              │  compose down   │              │
         │              └─────────────────┘              │
```

## Files

- `setup.ts` - E2E environment setup and teardown
- `docker-lifecycle.ts` - Docker Compose management
- `kaneo-test-client.ts` - Test client for resource management
- `task-lifecycle.test.ts` - Task CRUD tests
- `label-management.test.ts` - Label CRUD tests
- `project-lifecycle.test.ts` - Project CRUD tests
