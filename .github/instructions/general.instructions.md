---
applyTo: 'src/**'
---

# General Source Conventions

## Runtime & Language

- **Bun** runtime (not Node) — no build step, TypeScript runs directly
- **Strict TypeScript** with all safety flags (`tsconfig.json`)
- **Zod v4** for all runtime validation
- **Vercel AI SDK** (`ai` package) for LLM integration

## Linting & Formatting

- **oxlint** for linting, **oxfmt** for formatting (NOT ESLint/Prettier)
- NEVER add lint-disable comments (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `oxlint-disable`) — fix the underlying issue
- Use `param !== undefined` (not `!!param`) for presence checks (strict-boolean-expressions)

## Error Handling

- Use `AppError` discriminated union from `src/errors.ts`
- Error message extraction: `error instanceof Error ? error.message : String(error)`
- Provider errors classified via `classify-error.ts` per provider
- User-facing messages via `getUserMessage(appError)`

## Logging (mandatory — pino with structured JSON)

```typescript
import { logger } from '../logger.js'
const log = logger.child({ scope: 'module-name' })
```

| Level   | Use for                                                                      |
| ------- | ---------------------------------------------------------------------------- |
| `debug` | Function entry with parameters, internal state, API call initiation          |
| `info`  | Successful completion of major operations, service call results              |
| `warn`  | Invalid input, missing optional data, failed lookups, unauthorized attempts  |
| `error` | Caught exceptions, failed API calls — always include error message + context |

- First argument: structured metadata object. Second argument: message string.
- Never log API keys, tokens, or personal info.

## Imports

- Use `.js` extension in import paths (Bun ESM resolution)
- Import types with `import type { ... }` when only used as types
