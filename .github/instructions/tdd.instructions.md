---
applyTo: 'src/**'
---

# TDD Workflow — Red → Green → Refactor

Every implementation change in `src/` MUST follow the TDD cycle. This is enforced
by hooks in Claude Code but applies as a mandatory workflow for all AI tools.

## Before editing any file in `src/`

1. Check that a corresponding test file exists: `src/foo/bar.ts` → `tests/foo/bar.test.ts`
2. If no test file exists, create one FIRST with a failing test
3. Only then proceed to edit the implementation file

## After editing any file in `src/`

1. Run the related test: `bun test tests/foo/bar.test.ts`
2. If tests fail, fix the implementation before proceeding
3. Do NOT move on with failing tests

## Hard Rules

1. Never touch an implementation file before its test file exists
2. Never proceed past a RED test, even temporarily
3. Test naming convention: `src/foo/bar.ts` → `tests/foo/bar.test.ts`
4. Write the minimum implementation to make tests pass — no speculative code
