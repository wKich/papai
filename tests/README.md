# Test Suite: Plane Migration & E2E Testing

Test suite for validating Linear to Plane migration and Plane E2E functionality.

## Overview

This test suite focuses on:

1. **Migration Tests**: Testing data transformation from Linear to Plane
2. **Plane E2E Tests**: Testing actual Plane API functionality

**Note**: No mocks, no performance tests, no Linear E2E tests. Tests run against real Plane API.

## Directory Structure

```
tests/
├── migration/                # Linear → Plane migration tests
│   ├── create-issue.test.ts
│   ├── update-issue.test.ts
│   ├── search-issues.test.ts
│   ├── list-projects.test.ts
│   ├── archive-issue.test.ts
│   └── ... (22 migration tests)
├── e2e/                      # Plane E2E tests
│   ├── work-items/           # CRUD operations
│   │   ├── create.test.ts
│   │   ├── update.test.ts
│   │   ├── list.test.ts
│   │   └── delete.test.ts
│   ├── projects/             # Project operations
│   │   ├── create.test.ts
│   │   ├── list.test.ts
│   │   └── archive.test.ts
│   ├── labels/               # Label operations
│   │   ├── create.test.ts
│   │   └── list.test.ts
│   └── workflows/            # Full workflows
│       ├── issue-lifecycle.test.ts
│       └── project-management.test.ts
├── fixtures/                 # Test data
│   └── datasets/
│       ├── priority-mappings.ts
│       ├── relation-mappings.ts
│       └── sample-linear-data.ts
├── utils/                    # Test utilities
│   ├── test-helpers.ts
│   └── plane-client.ts
├── linear/                   # Existing Linear tests (kept)
├── tools/                    # Existing tool tests (kept)
└── setup.ts                  # Test configuration
```

## Running Tests

### Prerequisites

Set up environment variables:

```bash
# Plane Test Configuration
export PLANE_TEST_API_KEY=your-plane-api-key
export PLANE_TEST_WORKSPACE=your-workspace-slug
export PLANE_TEST_PROJECT_ID=your-project-id
export PLANE_TEST_URL=http://localhost:3000  # or your instance

# Linear Test Configuration (for migration tests)
export LINEAR_TEST_API_KEY=your-linear-api-key
export LINEAR_TEST_TEAM_ID=your-team-id
```

### Run All Tests

```bash
bun test
```

### Run Specific Test Suites

```bash
# Migration tests only
bun test tests/migration/

# E2E tests only
bun test tests/e2e/

# Specific migration test
bun test tests/migration/create-issue.test.ts

# Specific E2E test
bun test tests/e2e/work-items/create.test.ts
```

### Run with Coverage

```bash
bun test --coverage
```

## Test Categories

### Migration Tests

Validate that Linear data correctly transforms and imports to Plane:

- Data field mappings
- Priority conversions (0-4 → strings)
- Relation type mappings
- Description format conversions (Markdown → HTML)
- Date/estimate transformations

Example:

```typescript
test('transforms Linear issue to Plane work item', async () => {
  const linearIssue = { title: 'Bug', priority: 2 }

  const planeWorkItem = await createPlaneWorkItem({
    name: linearIssue.title,
    priority: LINEAR_TO_PLANE_PRIORITY[linearIssue.priority], // 'high'
  })

  expect(planeWorkItem.name).toBe('Bug')
  expect(planeWorkItem.priority).toBe('high')
})
```

### Plane E2E Tests

Test actual Plane API functionality:

- CRUD operations on work items
- Project management
- Label operations
- Comments and relations
- Error handling

Example:

```typescript
test('creates work item with all fields', async () => {
  const workItem = await client.workItems.create(workspace, project, {
    name: 'Feature',
    priority: 'high',
    target_date: '2025-03-15',
  })

  expect(workItem.id).toBeDefined()
  expect(workItem.name).toBe('Feature')
})
```

## Test Principles

1. **Real API Testing**: No mocks, test against actual Plane instance
2. **Test Isolation**: Each test creates and cleans up its own data
3. **Clear Assertions**: Test specific values and behaviors
4. **Error Coverage**: Test both success and failure cases
5. **Documentation**: Document edge cases and behavioral differences

## Environment Setup

### Local Plane Instance

For testing without affecting production:

```bash
# Start local Plane instance
docker-compose -f tests/docker-compose.yml up -d

# Wait for services to start
sleep 30

# Create API key in the Plane UI
# Update .env file with credentials
```

### CI/CD

Tests run against a dedicated test workspace in CI.

## Best Practices

- Use `skipIfNoPlaneApi()` to skip tests when API key not available
- Always clean up test data (delete created items)
- Use descriptive test names: "should transform Linear priority 2 to Plane 'high'"
- Assert on specific values, not just existence
- Document edge cases and limitations

## Files

### Test Utilities

- `tests/setup.ts` - Test configuration and environment setup
- `tests/utils/test-helpers.ts` - Shared test utilities
- `tests/utils/plane-client.ts` - Plane SDK client wrapper

### Data Fixtures

- `tests/fixtures/datasets/priority-mappings.ts` - Priority value mappings
- `tests/fixtures/datasets/relation-mappings.ts` - Relation type mappings
- `tests/fixtures/datasets/sample-linear-data.ts` - Sample Linear data for tests

## Resources

- [Plane API Documentation](https://developers.plane.so/api-reference/introduction)
- [Plane Node SDK](https://github.com/makeplane/plane-node-sdk)
- [Test Suite Foundation](../docs/testing/test-suite-foundation.md)
