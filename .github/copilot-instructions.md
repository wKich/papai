# Copilot Instructions

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
