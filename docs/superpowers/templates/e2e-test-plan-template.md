# E2E Test Plan

Rename this file and title to match the specific behavior or journey before saving it as `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.

**Objective:** State the user-visible behavior being validated.

**Regression Boundary:** State what existing behavior must remain safe while adding this coverage.

**Realism Tier:** State the chosen tier and why cheaper tests are not enough.

**Platforms and Providers:** Name the included surfaces and the intentionally excluded ones.

---

## Architecture Path

```text
List the runtime path here, one boundary per line.
Example:
DM message
  -> auth check
  -> wizard interception
  -> LLM orchestrator
  -> tool capability gating
  -> task provider
  -> reply formatting
```

## Environment and Fixtures

- State runtime assumptions.
- State auth and config preconditions.
- List seeded users, projects, tasks, labels, files, or scheduler state.
- State teardown and isolation expectations.

## Scenario Matrix

| Scenario                      | Feature Tags                      | Journey Tags           | Layers Crossed                        | Trigger                       | User Oracle                       | System Oracle              | Failure Mode                                    | Cleanup                         | Notes                               |
| ----------------------------- | --------------------------------- | ---------------------- | ------------------------------------- | ----------------------------- | --------------------------------- | -------------------------- | ----------------------------------------------- | ------------------------------- | ----------------------------------- |
| Describe the happy path first | List the product domains involved | List the journey class | List the runtime boundaries exercised | Describe what starts the flow | Describe what the user should see | Describe the backend proof | Name the negative or degraded condition covered | Describe teardown and isolation | Note harness gaps or backend quirks |

Add more rows until the plan covers happy path, routing or permission gates, invalid input, external failure, persistence verification, and cleanup.

## Non-E2E Coverage

- List the behaviors intentionally pushed down to unit, integration, schema, or contract tests.
- Name anything explicitly left for manual verification.

## Harness Reuse and Gaps

- Name the existing harnesses to reuse.
- Name any new helper, fixture, or platform setup work required.

## Implementation Order

1. Start with the highest-signal happy path.
2. Add the most important negative path next.
3. Add context leakage, persistence, or cleanup coverage after the main flow is stable.
