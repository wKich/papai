# Custom Instructions Feature Design

**Date:** 2026-03-22
**Status:** Approved

## Summary

Allow users (DM) and group admins (group chats) to teach the bot persistent behavioral
preferences via natural language. Instructions are stored per context, injected into the
system prompt on every request, and managed entirely through natural language tool calls.

## Approach

LLM tools (Option A). Three new tools — `save_instruction`, `list_instructions`,
`delete_instruction` — are added to the tool set and always exposed (not capability-gated).
The system prompt instructs the LLM to call `save_instruction` when it detects a persistent
behavioral preference, and to confirm briefly. No extra LLM calls or dual-pass logic needed.

## Storage

New `user_instructions` SQLite table:

```
user_instructions
  context_id  TEXT  NOT NULL
  id          TEXT  NOT NULL  (UUID, primary key)
  text        TEXT  NOT NULL
  created_at  TEXT  NOT NULL
```

- `context_id` = existing `storageContextId` (handles DM and group scoping automatically)
- Cap: 20 instructions per context to prevent prompt bloat
- Cached in `UserCache` (new `instructions` field), loaded lazily on first access — same
  pattern as `facts` and `config`

## New Tools (`src/tools/instructions.ts`)

All three are registered unconditionally in `makeTools()`:

| Tool                     | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `save_instruction(text)` | Stores a new instruction; returns `{ id, text }` |
| `list_instructions()`    | Returns all instructions with IDs and text       |
| `delete_instruction(id)` | Removes instruction by ID                        |

**LLM guidance added to `STATIC_RULES`:**

```
CUSTOM INSTRUCTIONS — When the user expresses a persistent behavioral preference
("always", "never", "from now on", "remember to"), call save_instruction with the
preference as a short, clear statement. Confirm briefly. When asked to show or list
instructions, call list_instructions. When asked to remove or forget one, call
list_instructions first to find the ID, then call delete_instruction.
```

## System Prompt Injection

When instructions exist, a block is prepended to the system prompt before `STATIC_RULES`:

```
=== Custom instructions ===
- Always reply in Spanish
- Assign new tasks to @john by default
```

When no instructions exist, nothing is added. The `contextId` is already available in
`buildSystemPrompt()`.

## Error Handling & Edge Cases

- **Cap enforcement:** `save_instruction` returns an error if 20 instructions already exist;
  the LLM relays this to the user.
- **Duplicate detection:** Before saving, a simple case-insensitive word-overlap check (>80%
  overlap) skips saving and returns a note that a similar instruction already exists.
- **Delete not found:** `delete_instruction` returns a clear error if the ID is missing; the
  LLM re-fetches and retries.
- **`/clear` command:** Instructions survive `/clear` (consistent with config key persistence).

## Testing

- `tests/tools/instructions.test.ts` — save, list, delete, cap enforcement, duplicate
  detection, not-found error
- `tests/instructions.test.ts` — cache/DB layer: lazy loading, upsert, delete, cap at 20
- System prompt unit test — assert `=== Custom instructions ===` block present when
  instructions exist, absent when empty
