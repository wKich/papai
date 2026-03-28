---
applyTo: "src/tools/**"
---

# Tool Conventions

## Definition Pattern

Tools use the Vercel AI SDK `tool()` factory from the `ai` package:

```typescript
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

const log = logger.child({ scope: 'tool:tool-name' })

export function makeToolNameTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Clear description of what the tool does',
    inputSchema: z.object({
      requiredField: z.string().describe('What this field represents'),
      optionalField: z.string().optional().describe('Optional field description'),
    }),
    execute: async ({ requiredField, optionalField }) => {
      try {
        const result = await provider.someMethod({ requiredField, optionalField })
        log.info({ resultId: result.id }, 'Action completed')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'tool_name' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

## Naming

- Factory function: `make[Action]Tool` — e.g. `makeCreateTaskTool`, `makeSearchTasksTool`
- Tool key in toolset: `snake_case` — e.g. `create_task`, `search_tasks`, `add_comment`
- One tool per file in `src/tools/`

## Input Schema

- Use `.describe()` on every field — the LLM reads these descriptions to decide how to call the tool
- Use Zod v4 types: `z.string()`, `z.number()`, `z.enum()`, `z.boolean()`
- Mark optional fields with `.optional()`
- Do NOT add default values in schemas — let the LLM decide

## Capability Gating

Tools are assembled in `src/tools/index.ts` via `makeTools(provider)`. Optional tools are added only if the provider supports the required capability:

```typescript
if (provider.capabilities.has('tasks.archive')) {
  tools['archive_task'] = makeArchiveTaskTool(provider)
}
```

Core tools (create, get, update, list, search tasks) are always included.

## Destructive Actions

Tools for destructive actions (archive, delete) must include a `confidence` field (0-1 float). If confidence < 0.85, return `{ status: 'confirmation_required', message: '...' }` instead of executing. Never leak the threshold value in the message.

## Logging (mandatory)

- `log.info()` on successful execution with result identifiers
- `log.error()` on caught exceptions with error message and tool name
- Error message extraction: `error instanceof Error ? error.message : String(error)`
