# Remove Labels and Archive Issues Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two new tools to the Telegram bot: `remove_issue_label` to remove labels from issues and `archive_issue` to archive issues in Linear.

**Architecture:** Follow the existing pattern of 13 tools - each has a Linear SDK wrapper function in `src/linear/` and a tool definition in `src/tools/`. Both tools will use the existing error handling patterns and logging requirements.

**Tech Stack:** TypeScript, Bun, @linear/sdk, Zod v4, Vercel AI SDK, Grammy bot framework, pino logging

---

## Overview

Based on Linear SDK analysis:

- **Remove labels**: `IssueRemoveLabelMutation.fetch(issueId, labelId)` → returns `IssuePayload`
- **Archive issues**: `ArchiveIssueMutation.fetch(issueId)` → returns `IssueArchivePayload`

Both operations follow the existing pattern in the codebase.

---

## Task 1: Remove Label from Issue - Linear Wrapper

**Files:**

- Create: `src/linear/remove-issue-label.ts`

**Step 1: Create the Linear wrapper function**

Create `src/linear/remove-issue-label.ts`:

```typescript
import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

export async function removeIssueLabel({
  apiKey,
  issueId,
  labelId,
}: {
  apiKey: string
  issueId: string
  labelId: string
}): Promise<{ id: string; identifier: string; title: string; url: string } | undefined> {
  logger.debug({ issueId, labelId }, 'removeIssueLabel called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.issueRemoveLabel(issueId, labelId)
    const issue = requireEntity(await payload.issue, {
      entityName: 'issue',
      context: { issueId, labelId },
      appError: linearError.issueNotFound(issueId),
    })
    logger.info({ issueId, labelId, identifier: issue.identifier }, 'Label removed from issue')
    return { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), issueId, labelId },
      'removeIssueLabel failed',
    )
    throw classifyLinearError(error)
  }
}
```

**Step 2: Export from linear index**

Modify `src/linear/index.ts` to add export:

```typescript
export { removeIssueLabel } from './remove-issue-label.js'
```

**Step 3: Verify syntax**

Run: `bun run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/linear/remove-issue-label.ts src/linear/index.ts
git commit -m "feat(linear): add removeIssueLabel wrapper function"
```

---

## Task 2: Remove Label from Issue - Tool Definition

**Files:**

- Create: `src/tools/remove-issue-label.ts`
- Modify: `src/tools/index.ts:17-35`

**Step 1: Create the tool definition**

Create `src/tools/remove-issue-label.ts`:

```typescript
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { removeIssueLabel } from '../linear/index.js'
import { logger } from '../logger.js'

export function makeRemoveIssueLabelTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Remove a label from a Linear issue. Use this when the user wants to remove a label from an issue.',
    inputSchema: z.object({
      issueId: z.string().describe("The Linear issue ID (e.g. 'abc123')"),
      labelId: z.string().describe('The label ID to remove. Call get_issue_labels first to get available label IDs.'),
    }),
    execute: async ({ issueId, labelId }) => {
      try {
        const result = await removeIssueLabel({ apiKey: linearKey, issueId, labelId })
        if (!result) {
          logger.warn({ issueId, labelId }, 'removeIssueLabel returned no result')
        }
        return result ?? { success: false, message: 'Failed to remove label' }
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            issueId,
            labelId,
            tool: 'remove_issue_label',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

**Step 2: Add import and export to tools index**

Modify `src/tools/index.ts`:

Add import at top:

```typescript
import { makeRemoveIssueLabelTool } from './remove-issue-label.js'
```

Add to ToolSet return object:

```typescript
remove_issue_label: makeRemoveIssueLabelTool(linearKey),
```

**Step 3: Verify syntax**

Run: `bun run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/tools/remove-issue-label.ts src/tools/index.ts
git commit -m "feat(tools): add remove_issue_label tool"
```

---

## Task 3: Archive Issue - Linear Wrapper

**Files:**

- Create: `src/linear/archive-issue.ts`

**Step 1: Create the Linear wrapper function**

Create `src/linear/archive-issue.ts`:

```typescript
import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

export async function archiveIssue({
  apiKey,
  issueId,
}: {
  apiKey: string
  issueId: string
}): Promise<{ id: string; identifier: string; title: string; archivedAt: string } | undefined> {
  logger.debug({ issueId }, 'archiveIssue called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.archiveIssue(issueId)
    const issue = requireEntity(await payload.issue, {
      entityName: 'issue',
      context: { issueId },
      appError: linearError.issueNotFound(issueId),
    })
    logger.info({ issueId, identifier: issue.identifier, archivedAt: issue.archivedAt }, 'Issue archived')
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      archivedAt: issue.archivedAt ?? new Date().toISOString(),
    }
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'archiveIssue failed')
    throw classifyLinearError(error)
  }
}
```

**Step 2: Export from linear index**

Modify `src/linear/index.ts` to add export:

```typescript
export { archiveIssue } from './archive-issue.js'
```

**Step 3: Verify syntax**

Run: `bun run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/linear/archive-issue.ts src/linear/index.ts
git commit -m "feat(linear): add archiveIssue wrapper function"
```

---

## Task 4: Archive Issue - Tool Definition

**Files:**

- Create: `src/tools/archive-issue.ts`
- Modify: `src/tools/index.ts:17-35`

**Step 1: Create the tool definition**

Create `src/tools/archive-issue.ts`:

```typescript
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { archiveIssue } from '../linear/index.js'
import { logger } from '../logger.js'

export function makeArchiveIssueTool(linearKey: string): ToolSet[string] {
  return tool({
    description:
      'Archive a Linear issue. Use this when the user wants to archive/delete an issue. Archived issues can be restored later.',
    inputSchema: z.object({
      issueId: z.string().describe("The Linear issue ID to archive (e.g. 'abc123')"),
    }),
    execute: async ({ issueId }) => {
      try {
        const result = await archiveIssue({ apiKey: linearKey, issueId })
        if (!result) {
          logger.warn({ issueId }, 'archiveIssue returned no result')
        }
        return result ?? { success: false, message: 'Failed to archive issue' }
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'archive_issue' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

**Step 2: Add import and export to tools index**

Modify `src/tools/index.ts`:

Add import at top:

```typescript
import { makeArchiveIssueTool } from './archive-issue.js'
```

Add to ToolSet return object:

```typescript
archive_issue: makeArchiveIssueTool(linearKey),
```

**Step 3: Verify syntax**

Run: `bun run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/tools/archive-issue.ts src/tools/index.ts
git commit -m "feat(tools): add archive_issue tool"
```

---

## Task 5: Update Roadmap

**Files:**

- Modify: `ROADMAP.md:19-20`

**Step 1: Mark features as complete**

Update `ROADMAP.md`:

```markdown
- [x] Remove labels from issues
- [x] Delete / archive issues
```

**Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark remove labels and archive issues as complete"
```

---

## Task 6: Final Verification

**Step 1: Run linting**

Run: `bun run lint`
Expected: No errors

**Step 2: Run type checking**

Run: `bun run typecheck` (if available) or `bun run build` to check types
Expected: No type errors

**Step 3: Final commit if any changes**

```bash
git status
# If any changes:
git add -A
git commit -m "style: fix formatting"
```

---

## Summary of Changes

**New files:**

1. `src/linear/remove-issue-label.ts` - Linear SDK wrapper for removing labels
2. `src/tools/remove-issue-label.ts` - Tool definition for remove_issue_label
3. `src/linear/archive-issue.ts` - Linear SDK wrapper for archiving issues
4. `src/tools/archive-issue.ts` - Tool definition for archive_issue

**Modified files:**

1. `src/linear/index.ts` - Add exports for new functions
2. `src/tools/index.ts` - Add imports and tool registrations
3. `ROADMAP.md` - Mark features as complete

**Total:** 4 new files, 3 modified files, 6 commits

---

## Testing Notes

These tools can be tested manually:

1. **remove_issue_label:**
   - First use `get_issue_labels` to see current labels
   - Then use `remove_issue_label` with the label ID
   - Verify with `get_issue_labels` again

2. **archive_issue:**
   - Use `archive_issue` with an issue ID
   - The issue should no longer appear in normal searches
   - Check Linear UI to confirm it's in archived state

---

## Design Decisions

1. **Separate tools vs extending update_issue**: We created separate tools rather than extending `update_issue` because:
   - Remove label requires a specific SDK mutation (`issueRemoveLabel`)
   - Archive is a distinct operation from update
   - Clearer UX for the LLM to understand when to use each tool

2. **Return types**: We return essential issue info (id, identifier, title) plus operation-specific fields:
   - remove_issue_label: returns url for user confirmation
   - archive_issue: returns archivedAt timestamp for verification

3. **Error handling**: Follows existing patterns with `classifyLinearError` and proper logging at all levels

4. **No batch operations**: Single issue/label per call for simplicity, matching existing tool patterns
