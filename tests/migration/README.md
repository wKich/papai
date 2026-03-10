# Migration Tests

Tests for validating Linear to Plane data transformations.

## Purpose

These tests ensure that Linear data correctly maps to Plane format:

- Field name mappings (title → name)
- Value transformations (priority numbers → strings)
- Format conversions (Markdown → HTML)
- Relation mappings

## Running Tests

```bash
# All migration tests
bun test tests/migration/

# Specific test
bun test tests/migration/create-issue.test.ts
```

## Test Structure

Each test validates transformation logic:

```typescript
test('transforms Linear priority to Plane', () => {
  const linearPriority = 2 // high
  const planePriority = LINEAR_TO_PLANE_PRIORITY[linearPriority]

  expect(planePriority).toBe('high')
})
```

## Coverage

22 Linear methods mapped to Plane equivalents:

- Issues → Work Items
- Projects → Projects
- Labels → Labels
- Comments → Comments
- Relations → Relations

## Files

- `create-issue.test.ts` - Issue creation migration
- `update-issue.test.ts` - Issue update migration
- `search-issues.test.ts` - Search/filter migration
- `list-projects.test.ts` - Project listing migration
- `archive-issue.test.ts` - Issue archival migration
- ... (18 more)

## Notes

- Tests validate transformation logic without actual API calls
- Real API tests are in `tests/e2e/`
- Data fixtures in `tests/fixtures/datasets/`
