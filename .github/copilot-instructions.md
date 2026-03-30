# Copilot Instructions

## Path-scoped guidelines

Detailed conventions are in `.github/instructions/*.instructions.md` files, auto-loaded by glob:

| File                            | Scope              | Covers                                                            |
| ------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `general.instructions.md`       | `src/**`           | Runtime, linting, logging, error handling, imports                |
| `providers.instructions.md`     | `src/providers/**` | TaskProvider interface, operations, schemas, error classification |
| `tools.instructions.md`         | `src/tools/**`     | Tool definitions, capability gating, destructive actions          |
| `commands.instructions.md`      | `src/commands/**`  | Command handler pattern, auth checks, ReplyFn                     |
| `chat-adapters.instructions.md` | `src/chat/**`      | ChatProvider interface, platform adapters                         |
| `testing.instructions.md`       | `tests/**`         | Test helpers, mocking rules, mock pollution prevention            |
| `e2e-testing.instructions.md`   | `tests/e2e/**`     | E2E test structure, KaneoTestClient, Docker-based tests           |
| `tdd.instructions.md`           | `src/**`           | TDD workflow: test-first, Red→Green→Refactor                      |

## No lint-disable comments

Never suppress lint or type errors with disable comments. Fix the underlying issue instead.

Forbidden patterns:

- `eslint-disable` / `eslint-disable-next-line` (any rule)
- `@ts-ignore`
- `@ts-nocheck`
- `oxlint-disable`

If a lint rule flags code you wrote, fix the code — do not silence the rule.

## Pre-completion check

Before ending any response that includes code changes, scan every modified file for the forbidden patterns above. If any are found, remove them and fix the underlying issue before finishing.
