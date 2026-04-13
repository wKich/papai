# File Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared attachment pipeline so incoming chat files persist until `/clear`, can be uploaded by tools via stable attachment IDs, and can be sent to multimodal models without polluting conversation history.

**Architecture:** Add a new `src/attachments/` subsystem that becomes the durable source of truth for attachments. Chat adapters keep producing raw `IncomingFile` payloads, bot intake persists them into SQLite metadata plus on-disk blobs and queues stable IDs, prompt/LLM layers use attachment refs plus resolver-controlled hydration, and `/clear` clears attachment state together with history and memory.

**Tech Stack:** TypeScript, Bun, Bun SQLite + Drizzle, Vercel AI SDK v6, existing message queue, existing chat provider capabilities, existing command/test helpers

---

## Scope Check

This stays as one implementation plan. The database, attachment workspace, bot queue, tool wiring, and LLM wiring form a single vertical feature slice; splitting them into separate plans would leave partially-usable behavior behind (for example, persisted attachments with no tool access, or multimodal LLM input with no durable storage).

## File Structure

```text
src/
├── attachments/
│   ├── index.ts                 # Public exports for attachment APIs
│   ├── types.ts                 # AttachmentRef, StoredAttachment, status/input types
│   ├── store.ts                 # SQLite metadata + blob persistence
│   ├── workspace.ts             # Active attachment queries and clear behavior
│   ├── ingest.ts                # Convert IncomingFile[] into persisted AttachmentRef[]
│   └── resolver.ts              # Manifest building, model fallback, history placeholders
├── bot.ts                       # Persist attachments before queueing; queue stable IDs
├── commands/clear.ts            # Clear attachment workspace with history + memory
├── db/
│   ├── schema.ts                # attachments table schema
│   ├── index.ts                 # Register migration019 + migration020 in runtime order
│   └── migrations/
│       └── 020_attachment_workspace.ts
├── llm-orchestrator.ts          # Accept structured turn input and hydrate multipart content
├── llm-orchestrator-types.ts    # ProcessMessageInput type
├── message-queue/
│   ├── types.ts                 # QueueItem carries newAttachmentIds, not raw files
│   └── queue.ts                 # Coalesce stable attachment IDs
├── reply-context.ts             # Render attachment manifest using papai attachment IDs
├── tools/upload-attachment.ts   # Resolve workspace attachmentId instead of transient fileId
├── chat/discord/metadata.ts     # Stop advertising files.receive until ingress exists
└── file-relay.ts                # Delete after upload_attachment stops using it

tests/
├── attachments/
│   ├── store.test.ts            # Durable store behavior and blob IO
│   ├── workspace.test.ts        # Persist/list/clear active attachment behavior
│   └── resolver.test.ts         # Manifest building and model/tool fallback
├── bot.test.ts                  # Bot intake persists attachments and forwards IDs
├── commands/
│   └── clear.test.ts            # /clear clears attachment workspace
├── db/
│   ├── migrations/
│   │   └── 020_attachment_workspace.test.ts
│   └── schema.test.ts           # attachments table is exposed through Drizzle schema
├── llm-orchestrator.test.ts     # Multipart model input + history placeholder behavior
├── message-queue/
│   ├── types.test.ts
│   ├── queue.test.ts
│   └── index.integration.test.ts
├── reply-context.test.ts        # Manifest prompt text uses attachmentId refs
├── tools/
│   └── attachment-tools.test.ts # upload_attachment uses workspace attachment IDs
└── chat/
    ├── discord/metadata.test.ts # files.receive removed until Discord ingress exists
    ├── telegram/index.test.ts   # Existing ingress guardrail, no new source changes expected
    └── mattermost/index.test.ts # Existing ingress guardrail, no new source changes expected
```

**Testing note:** new mirrored `tests/attachments/*.test.ts`, existing `tests/message-queue/*.test.ts`, and `tests/commands/clear.test.ts` must be run explicitly with `bun test <path>` because the default `bun test` script does not include those directories today.

---

### Task 1: Add the attachment workspace migration and schema

**Files:**

- Create: `src/db/migrations/020_attachment_workspace.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/schema.ts`
- Modify: `tests/utils/test-helpers.ts`
- Test: `tests/db/migrations/020_attachment_workspace.test.ts`
- Test: `tests/db/schema.test.ts`

- [ ] **Step 1: Write the failing migration and schema tests**

```typescript
// tests/db/migrations/020_attachment_workspace.test.ts
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration020AttachmentWorkspace } from '../../../src/db/migrations/020_attachment_workspace.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getNames = (db: Database, type: 'table' | 'index'): string[] =>
  db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((row) => row.name)

describe('migration020AttachmentWorkspace', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates attachments table and active-state indexes', () => {
    migration020AttachmentWorkspace.up(db)

    expect(getNames(db, 'table')).toContain('attachments')
    expect(getNames(db, 'index')).toContain('idx_attachments_context_active')
    expect(getNames(db, 'index')).toContain('idx_attachments_context_checksum')
  })
})

// tests/db/schema.test.ts
import { describe, expect, it, beforeEach } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { attachments } from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachments schema', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('exposes the attachments table through Drizzle', () => {
    const db = getDrizzleDb()
    expect(db).toBeDefined()
    expect(attachments.attachmentId).toBeDefined()
    expect(attachments.contextId).toBeDefined()
    expect(attachments.isActive).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the DB tests to verify they fail**

Run: `bun test tests/db/migrations/020_attachment_workspace.test.ts tests/db/schema.test.ts`
Expected: FAIL with `Cannot find module '../../../src/db/migrations/020_attachment_workspace.js'` and/or missing `attachments` export from `src/db/schema.ts`

- [ ] **Step 3: Add migration020, register it in runtime/test migrations, and expose the schema**

```typescript
// src/db/migrations/020_attachment_workspace.ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration020AttachmentWorkspace: Migration = {
  id: '020_attachment_workspace',
  up(db: Database): void {
    db.run(`
      CREATE TABLE attachments (
        attachment_id     TEXT PRIMARY KEY,
        context_id        TEXT NOT NULL,
        source_provider   TEXT NOT NULL,
        source_message_id TEXT,
        source_file_id    TEXT,
        filename          TEXT NOT NULL,
        mime_type         TEXT,
        size              INTEGER,
        checksum          TEXT NOT NULL,
        blob_path         TEXT NOT NULL,
        status            TEXT NOT NULL,
        is_active         INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL,
        cleared_at        TEXT,
        last_used_at      TEXT
      )
    `)
    db.run(`CREATE INDEX idx_attachments_context_active ON attachments(context_id, is_active, created_at)`)
    db.run(`CREATE INDEX idx_attachments_context_checksum ON attachments(context_id, checksum)`)
  },
}

// src/db/index.ts
import { migration019UserIdentityMappings } from './migrations/019_user_identity_mappings.js'
import { migration020AttachmentWorkspace } from './migrations/020_attachment_workspace.js'

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
  migration009RecurringTasks,
  migration010RecurringTaskOccurrences,
  migration011ProactiveAlerts,
  migration012UserInstructions,
  migration013DeferredPrompts,
  migration014BackgroundEvents,
  migration015DropBackgroundEvents,
  migration016ExecutionMetadata,
  migration017MessageMetadata,
  migration018Memos,
  migration019UserIdentityMappings,
  migration020AttachmentWorkspace,
] as const

// src/db/schema.ts
export const attachments = sqliteTable(
  'attachments',
  {
    attachmentId: text('attachment_id').primaryKey(),
    contextId: text('context_id').notNull(),
    sourceProvider: text('source_provider').notNull(),
    sourceMessageId: text('source_message_id'),
    sourceFileId: text('source_file_id'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    size: integer('size'),
    checksum: text('checksum').notNull(),
    blobPath: text('blob_path').notNull(),
    status: text('status').notNull(),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull(),
    clearedAt: text('cleared_at'),
    lastUsedAt: text('last_used_at'),
  },
  (table) => [
    index('idx_attachments_context_active').on(table.contextId, table.isActive, table.createdAt),
    index('idx_attachments_context_checksum').on(table.contextId, table.checksum),
  ],
)

export type AttachmentRow = typeof attachments.$inferSelect

// tests/utils/test-helpers.ts
import { migration020AttachmentWorkspace } from '../../src/db/migrations/020_attachment_workspace.js'

const ALL_MIGRATIONS: readonly Migration[] = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
  migration009RecurringTasks,
  migration010RecurringTaskOccurrences,
  migration011ProactiveAlerts,
  migration012UserInstructions,
  migration013DeferredPrompts,
  migration014BackgroundEvents,
  migration015DropBackgroundEvents,
  migration016ExecutionMetadata,
  migration017MessageMetadata,
  migration018Memos,
  migration019UserIdentityMappings,
  migration020AttachmentWorkspace,
]
```

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `bun test tests/db/migrations/020_attachment_workspace.test.ts tests/db/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/020_attachment_workspace.ts src/db/index.ts src/db/schema.ts tests/db/migrations/020_attachment_workspace.test.ts tests/db/schema.test.ts tests/utils/test-helpers.ts
git commit -m "feat(attachments): add attachment workspace schema" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Implement the durable attachment store

**Files:**

- Create: `src/attachments/types.ts`
- Create: `src/attachments/store.ts`
- Create: `src/attachments/index.ts`
- Test: `tests/attachments/store.test.ts`

- [ ] **Step 1: Write the failing store test**

```typescript
// tests/attachments/store.test.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { loadAttachmentRecord, saveAttachment } from '../../src/attachments/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachment store', () => {
  let attachmentsDir: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    attachmentsDir = mkdtempSync(join(tmpdir(), 'papai-attachments-'))
    process.env['ATTACHMENTS_DIR'] = attachmentsDir
  })

  afterEach(() => {
    rmSync(attachmentsDir, { recursive: true, force: true })
    delete process.env['ATTACHMENTS_DIR']
  })

  test('persists metadata in SQLite and bytes in the blob directory', () => {
    const ref = saveAttachment({
      contextId: 'ctx-store',
      sourceProvider: 'telegram',
      sourceMessageId: 'm-1',
      sourceFileId: 'f-1',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 4,
      status: 'available',
      content: Buffer.from('data'),
    })

    const record = loadAttachmentRecord('ctx-store', ref.attachmentId)

    expect(record).not.toBeNull()
    expect(record?.filename).toBe('report.pdf')
    expect(record?.content.toString('utf8')).toBe('data')
    expect(existsSync(record?.blobPath ?? '')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the store test to verify it fails**

Run: `bun test tests/attachments/store.test.ts`
Expected: FAIL with `Cannot find module '../../src/attachments/store.js'`

- [ ] **Step 3: Create attachment types, the store implementation, and re-exports**

```typescript
// src/attachments/types.ts
export type AttachmentStatus = 'available' | 'tool_only' | 'rejected' | 'unavailable'

export type AttachmentRef = {
  attachmentId: string
  contextId: string
  filename: string
  mimeType?: string
  size?: number
  status: AttachmentStatus
}

export type StoredAttachment = AttachmentRef & {
  sourceProvider: 'telegram' | 'mattermost' | 'discord' | 'unknown'
  sourceMessageId?: string
  sourceFileId?: string
  checksum: string
  blobPath: string
  createdAt: string
  clearedAt?: string | null
  lastUsedAt?: string | null
  content: Buffer
}

export type SaveAttachmentInput = {
  contextId: string
  sourceProvider: 'telegram' | 'mattermost' | 'discord' | 'unknown'
  sourceMessageId?: string
  sourceFileId?: string
  filename: string
  mimeType?: string
  size?: number
  status: AttachmentStatus
  content: Buffer
}

// src/attachments/store.ts
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { eq, and } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { attachments } from '../db/schema.js'
import { logger } from '../logger.js'
import type { AttachmentRef, SaveAttachmentInput, StoredAttachment } from './types.js'

const log = logger.child({ scope: 'attachments:store' })

const getAttachmentsDir = (): string => process.env['ATTACHMENTS_DIR'] ?? 'papai-attachments'

const ensureAttachmentsDir = (): string => {
  const dir = getAttachmentsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function saveAttachment(input: SaveAttachmentInput): AttachmentRef {
  const attachmentId = `att_${randomUUID()}`
  const createdAt = new Date().toISOString()
  const checksum = createHash('sha256').update(input.content).digest('hex')
  const blobPath = join(ensureAttachmentsDir(), attachmentId)

  writeFileSync(blobPath, input.content)

  getDrizzleDb()
    .insert(attachments)
    .values({
      attachmentId,
      contextId: input.contextId,
      sourceProvider: input.sourceProvider,
      sourceMessageId: input.sourceMessageId,
      sourceFileId: input.sourceFileId,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      checksum,
      blobPath,
      status: input.status,
      isActive: 1,
      createdAt,
      clearedAt: null,
      lastUsedAt: null,
    })
    .run()

  log.info({ attachmentId, contextId: input.contextId, filename: input.filename }, 'Attachment stored')

  return {
    attachmentId,
    contextId: input.contextId,
    filename: input.filename,
    mimeType: input.mimeType,
    size: input.size,
    status: input.status,
  }
}

export function loadAttachmentRecord(contextId: string, attachmentId: string): StoredAttachment | null {
  const row = getDrizzleDb()
    .select()
    .from(attachments)
    .where(and(eq(attachments.contextId, contextId), eq(attachments.attachmentId, attachmentId)))
    .get()

  if (row === undefined || row.clearedAt !== null) return null

  return {
    attachmentId: row.attachmentId,
    contextId: row.contextId,
    filename: row.filename,
    mimeType: row.mimeType ?? undefined,
    size: row.size ?? undefined,
    status: row.status as StoredAttachment['status'],
    sourceProvider: row.sourceProvider as StoredAttachment['sourceProvider'],
    sourceMessageId: row.sourceMessageId ?? undefined,
    sourceFileId: row.sourceFileId ?? undefined,
    checksum: row.checksum,
    blobPath: row.blobPath,
    createdAt: row.createdAt,
    clearedAt: row.clearedAt,
    lastUsedAt: row.lastUsedAt,
    content: Buffer.from(readFileSync(row.blobPath)),
  }
}

// src/attachments/index.ts
export type { AttachmentRef, AttachmentStatus, SaveAttachmentInput, StoredAttachment } from './types.js'
export { loadAttachmentRecord, saveAttachment } from './store.js'
```

- [ ] **Step 4: Run the store test to verify it passes**

Run: `bun test tests/attachments/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attachments/types.ts src/attachments/store.ts src/attachments/index.ts tests/attachments/store.test.ts
git commit -m "feat(attachments): add durable attachment store" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Implement workspace queries, clear behavior, and ingest

**Files:**

- Create: `src/attachments/workspace.ts`
- Create: `src/attachments/ingest.ts`
- Modify: `src/attachments/index.ts`
- Test: `tests/attachments/workspace.test.ts`

- [ ] **Step 1: Write the failing workspace/ingest test**

```typescript
// tests/attachments/workspace.test.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { persistIncomingAttachments } from '../../src/attachments/ingest.js'
import { clearAttachmentWorkspace, listActiveAttachments } from '../../src/attachments/workspace.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachment workspace', () => {
  let attachmentsDir: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    attachmentsDir = mkdtempSync(join(tmpdir(), 'papai-attachments-'))
    process.env['ATTACHMENTS_DIR'] = attachmentsDir
  })

  afterEach(() => {
    rmSync(attachmentsDir, { recursive: true, force: true })
    delete process.env['ATTACHMENTS_DIR']
  })

  test('persists incoming files, lists them as active, and clears them by context', () => {
    const refs = persistIncomingAttachments({
      contextId: 'ctx-workspace',
      sourceProvider: 'mattermost',
      sourceMessageId: 'm-42',
      files: [
        {
          fileId: 'platform-f1',
          filename: 'diagram.png',
          mimeType: 'image/png',
          size: 7,
          content: Buffer.from('pngdata'),
        },
      ],
    })

    expect(refs).toHaveLength(1)
    expect(refs[0]?.attachmentId.startsWith('att_')).toBe(true)
    expect(listActiveAttachments('ctx-workspace')).toHaveLength(1)

    clearAttachmentWorkspace('ctx-workspace')

    expect(listActiveAttachments('ctx-workspace')).toEqual([])
    expect(existsSync(join(attachmentsDir, refs[0]!.attachmentId))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the workspace test to verify it fails**

Run: `bun test tests/attachments/workspace.test.ts`
Expected: FAIL with `Cannot find module '../../src/attachments/workspace.js'` and/or `Cannot find module '../../src/attachments/ingest.js'`

- [ ] **Step 3: Add workspace and ingest helpers**

```typescript
// src/attachments/workspace.ts
import { existsSync, rmSync } from 'node:fs'

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { attachments } from '../db/schema.js'
import { logger } from '../logger.js'
import type { AttachmentRef } from './types.js'

const log = logger.child({ scope: 'attachments:workspace' })

export function listActiveAttachments(contextId: string): AttachmentRef[] {
  return getDrizzleDb()
    .select()
    .from(attachments)
    .where(and(eq(attachments.contextId, contextId), eq(attachments.isActive, 1)))
    .all()
    .filter((row) => row.clearedAt === null)
    .map((row) => ({
      attachmentId: row.attachmentId,
      contextId: row.contextId,
      filename: row.filename,
      mimeType: row.mimeType ?? undefined,
      size: row.size ?? undefined,
      status: row.status as AttachmentRef['status'],
    }))
}

export function clearAttachmentWorkspace(contextId: string): void {
  const rows = getDrizzleDb()
    .select({ blobPath: attachments.blobPath })
    .from(attachments)
    .where(eq(attachments.contextId, contextId))
    .all()

  for (const row of rows) {
    if (existsSync(row.blobPath)) rmSync(row.blobPath, { force: true })
  }

  getDrizzleDb().delete(attachments).where(eq(attachments.contextId, contextId)).run()
  log.info({ contextId, count: rows.length }, 'Attachment workspace cleared')
}

// src/attachments/ingest.ts
import type { IncomingFile } from '../chat/types.js'
import type { AttachmentRef } from './types.js'
import { saveAttachment } from './store.js'

export function persistIncomingAttachments(params: {
  contextId: string
  sourceProvider: 'telegram' | 'mattermost' | 'discord' | 'unknown'
  sourceMessageId?: string
  files: readonly IncomingFile[]
}): AttachmentRef[] {
  return params.files.map((file) =>
    saveAttachment({
      contextId: params.contextId,
      sourceProvider: params.sourceProvider,
      sourceMessageId: params.sourceMessageId,
      sourceFileId: file.fileId,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      status: 'available',
      content: file.content,
    }),
  )
}

// src/attachments/index.ts
export { persistIncomingAttachments } from './ingest.js'
export { clearAttachmentWorkspace, listActiveAttachments } from './workspace.js'
```

- [ ] **Step 4: Run the workspace test to verify it passes**

Run: `bun test tests/attachments/workspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attachments/workspace.ts src/attachments/ingest.ts src/attachments/index.ts tests/attachments/workspace.test.ts
git commit -m "feat(attachments): add workspace ingest and clear helpers" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Add resolver rules and stable attachment manifests

**Files:**

- Create: `src/attachments/resolver.ts`
- Modify: `src/attachments/index.ts`
- Modify: `src/reply-context.ts`
- Test: `tests/attachments/resolver.test.ts`
- Modify: `tests/reply-context.test.ts`

- [ ] **Step 1: Write the failing resolver and prompt tests**

```typescript
// tests/attachments/resolver.test.ts
import { describe, expect, test } from 'bun:test'

import type { AttachmentRef } from '../../src/attachments/types.js'
import { buildAttachmentManifest, selectAttachmentsForTurn } from '../../src/attachments/resolver.js'

const refs: AttachmentRef[] = [
  {
    attachmentId: 'att_123',
    contextId: 'ctx',
    filename: 'design.pdf',
    mimeType: 'application/pdf',
    size: 12,
    status: 'available',
  },
  {
    attachmentId: 'att_456',
    contextId: 'ctx',
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 34,
    status: 'available',
  },
]

describe('attachment resolver', () => {
  test('builds a stable manifest using papai attachment ids', () => {
    expect(buildAttachmentManifest(refs)).toBe(
      '[Available attachments: att_123 design.pdf (application/pdf, 12 bytes); att_456 photo.jpg (image/jpeg, 34 bytes)]',
    )
  })

  test('uses new attachments by default and only explicit ids for old attachments', () => {
    const selected = selectAttachmentsForTurn({
      text: 'Please compare att_456 with the new upload',
      newAttachmentIds: ['att_123'],
      activeAttachments: refs,
    })

    expect(selected.map((ref) => ref.attachmentId)).toEqual(['att_123', 'att_456'])
  })
})

// tests/reply-context.test.ts
test('renders stable attachment ids instead of platform fileId metadata', () => {
  const msg = makeDmMessage({ text: 'Please review this' })
  const result = buildPromptWithReplyContext(msg, [
    {
      attachmentId: 'att_123',
      contextId: 'ctx1',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 12345,
      status: 'available',
    },
  ])

  expect(result).toContain('att_123 report.pdf (application/pdf, 12345 bytes)')
  expect(result).not.toContain('fileId=')
})
```

- [ ] **Step 2: Run the resolver/prompt tests to verify they fail**

Run: `bun test tests/attachments/resolver.test.ts tests/reply-context.test.ts`
Expected: FAIL with `Cannot find module '../../src/attachments/resolver.js'` and/or wrong `buildPromptWithReplyContext()` signature

- [ ] **Step 3: Implement resolver helpers and update the prompt builder signature**

```typescript
// src/attachments/resolver.ts
import type { AttachmentRef } from './types.js'

const MULTIMODAL_MODEL_PREFIXES = ['gpt-4o', 'gpt-4.1', 'claude-3', 'claude-sonnet-4', 'claude-opus-4']

export function supportsAttachmentModelInput(modelName: string): boolean {
  return MULTIMODAL_MODEL_PREFIXES.some((prefix) => modelName.startsWith(prefix))
}

export function buildAttachmentManifest(attachments: readonly AttachmentRef[]): string | null {
  if (attachments.length === 0) return null
  const rendered = attachments
    .map((attachment) => {
      const meta: string[] = []
      if (attachment.mimeType !== undefined) meta.push(attachment.mimeType)
      if (attachment.size !== undefined) meta.push(`${attachment.size} bytes`)
      const suffix = meta.length > 0 ? ` (${meta.join(', ')})` : ''
      return `${attachment.attachmentId} ${attachment.filename}${suffix}`
    })
    .join('; ')
  return `[Available attachments: ${rendered}]`
}

export function selectAttachmentsForTurn(params: {
  text: string
  newAttachmentIds: readonly string[]
  activeAttachments: readonly AttachmentRef[]
}): AttachmentRef[] {
  const mentionedIds = new Set(Array.from(params.text.matchAll(/\batt_[a-z0-9-]+\b/gi), (match) => match[0]))
  const selectedIds = new Set([...params.newAttachmentIds, ...mentionedIds])
  return params.activeAttachments.filter((attachment) => selectedIds.has(attachment.attachmentId))
}

export function buildHistoryAttachmentLines(attachments: readonly AttachmentRef[]): string[] {
  return attachments.map((attachment) => `[User attached ${attachment.attachmentId}: ${attachment.filename}]`)
}

// src/attachments/index.ts
export {
  buildAttachmentManifest,
  buildHistoryAttachmentLines,
  selectAttachmentsForTurn,
  supportsAttachmentModelInput,
} from './resolver.js'

// src/reply-context.ts
import type { AttachmentRef } from './attachments/types.js'
import { buildAttachmentManifest } from './attachments/index.js'

export function buildPromptWithReplyContext(msg: IncomingMessage, attachments: readonly AttachmentRef[] = []): string {
  const hasReplyContext = msg.replyContext !== undefined
  const manifest = buildAttachmentManifest(attachments)

  if (!hasReplyContext && manifest === null) {
    return msg.text
  }

  const context: string[] = []

  if (msg.replyContext !== undefined) {
    if (msg.replyContext.text !== undefined) {
      const author = msg.replyContext.authorUsername ?? 'user'
      context.push(`[Replying to message from ${author}: "${msg.replyContext.text}"]`)
    }
    if (msg.replyContext.quotedText !== undefined) {
      context.push(`[Quoted text: "${msg.replyContext.quotedText}"]`)
    }
    if (msg.replyContext.chainSummary !== undefined && msg.replyContext.chainSummary !== '') {
      context.push(`[Earlier context: ${msg.replyContext.chainSummary}]`)
    }
  }

  if (manifest !== null) context.push(manifest)

  return context.join('\n') + '\n\n' + msg.text
}
```

- [ ] **Step 4: Run the resolver/prompt tests to verify they pass**

Run: `bun test tests/attachments/resolver.test.ts tests/reply-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attachments/resolver.ts src/attachments/index.ts src/reply-context.ts tests/attachments/resolver.test.ts tests/reply-context.test.ts
git commit -m "feat(attachments): add resolver and prompt manifest" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Persist attachments in bot intake and queue stable IDs

**Files:**

- Modify: `src/llm-orchestrator-types.ts`
- Modify: `src/message-queue/types.ts`
- Modify: `src/message-queue/queue.ts`
- Modify: `src/bot.ts`
- Modify: `tests/message-queue/types.test.ts`
- Modify: `tests/message-queue/queue.test.ts`
- Modify: `tests/message-queue/index.integration.test.ts`
- Modify: `tests/bot.test.ts`

- [ ] **Step 1: Write the failing queue/bot tests for attachment IDs**

```typescript
// tests/message-queue/types.test.ts
test('QueueItem carries newAttachmentIds instead of raw files', () => {
  const item: QueueItem = {
    text: 'Hello',
    userId: '123',
    username: 'alice',
    storageContextId: '456',
    contextType: 'dm',
    newAttachmentIds: ['att_123'],
  }
  expect(item.newAttachmentIds).toEqual(['att_123'])
})

// tests/message-queue/queue.test.ts
it('accumulates newAttachmentIds from all messages', () => {
  queue.enqueue(
    {
      text: 'First',
      userId: 'user123',
      username: 'alice',
      storageContextId: 'user123',
      contextType: 'dm',
      newAttachmentIds: ['att_1'],
    },
    mockReply,
  )
  queue.enqueue(
    {
      text: 'Second',
      userId: 'user123',
      username: 'alice',
      storageContextId: 'user123',
      contextType: 'dm',
      newAttachmentIds: ['att_2'],
    },
    mockReply,
  )

  const flushed = queue.forceFlush()
  expect(flushed?.newAttachmentIds).toEqual(['att_1', 'att_2'])
})

// tests/bot.test.ts
import { listActiveAttachments } from '../src/attachments/index.js'
import type { ProcessMessageInput } from '../src/llm-orchestrator-types.js'

test('persists incoming files before processing and forwards stable ids', async () => {
  addUser('relay-user', RELAY_ADMIN)
  setupUserConfig('relay-user')

  let forwardedInput: ProcessMessageInput | null = null
  const botDeps: BotDeps = {
    processMessage: (_reply, _storageContextId, _username, input): Promise<void> => {
      forwardedInput = input
      return Promise.resolve()
    },
  }

  const file = makeFile()
  const msg: IncomingMessage = { ...createDmMessage('relay-user'), files: [file] }
  const { reply } = createMockReply()

  await getMessageHandler()!(msg, reply)

  expect(forwardedInput?.newAttachmentIds).toHaveLength(1)
  expect(listActiveAttachments('relay-user')).toHaveLength(1)
})
```

- [ ] **Step 2: Run the queue/bot tests to verify they fail**

Run: `bun test tests/message-queue/types.test.ts tests/message-queue/queue.test.ts tests/message-queue/index.integration.test.ts tests/bot.test.ts`
Expected: FAIL with type errors about missing `newAttachmentIds` and/or `processMessage` argument shape mismatch

- [ ] **Step 3: Change the bot and queue to carry stable attachment IDs**

```typescript
// src/llm-orchestrator-types.ts
export type ProcessMessageInput = {
  text: string
  newAttachmentIds: readonly string[]
}

// src/message-queue/types.ts
export interface QueueItem {
  readonly text: string
  readonly userId: string
  readonly username: string | null
  readonly storageContextId: string
  readonly contextType: 'dm' | 'group'
  readonly newAttachmentIds: readonly string[]
}

export interface CoalescedItem {
  readonly text: string
  readonly userId: string
  readonly username: string | null
  readonly storageContextId: string
  readonly newAttachmentIds: readonly string[]
  readonly reply: ReplyFn
}

// src/message-queue/queue.ts
const allAttachmentIds: string[] = []

for (const msg of this.messages) {
  if (isThread && msg.item.username !== null) {
    texts.push(`[@${msg.item.username}]: ${msg.item.text}`)
  } else {
    texts.push(msg.item.text)
  }
  allAttachmentIds.push(...msg.item.newAttachmentIds)
}

const result: CoalescedItem = {
  text,
  userId: firstMessage.item.userId,
  username: firstMessage.item.username,
  storageContextId: this.storageContextId,
  newAttachmentIds: allAttachmentIds,
  reply,
}

// src/bot.ts
import { listActiveAttachments, persistIncomingAttachments } from './attachments/index.js'
import type { ProcessMessageInput } from './llm-orchestrator-types.js'

export interface BotDeps {
  processMessage: (
    reply: ReplyFn,
    contextId: string,
    username: string | null,
    input: ProcessMessageInput,
  ) => Promise<void>
}

async function handleMessage(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  deps: BotDeps,
): Promise<void> {
  if (!auth.allowed) {
    if (msg.isMentioned) {
      await reply.text(
        "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser @{username}`",
      )
    }
    return
  }

  const newAttachmentRefs = persistIncomingAttachments({
    contextId: auth.storageContextId,
    sourceProvider: chat.name,
    sourceMessageId: msg.messageId,
    files: msg.files ?? [],
  })

  const activeAttachments = listActiveAttachments(auth.storageContextId)

  const queueItem = {
    text: buildPromptWithReplyContext(msg, activeAttachments),
    userId: msg.user.id,
    username: msg.user.username,
    storageContextId: auth.storageContextId,
    contextType: msg.contextType,
    newAttachmentIds: newAttachmentRefs.map((ref) => ref.attachmentId),
  }

  enqueueMessage(queueItem, reply, async (coalescedItem) => {
    await deps.processMessage(coalescedItem.reply, coalescedItem.storageContextId, coalescedItem.username, {
      text: coalescedItem.text,
      newAttachmentIds: coalescedItem.newAttachmentIds,
    })
  })
}

// update call site
await handleMessage(chat, msg, reply, auth, deps)
```

- [ ] **Step 4: Run the queue/bot tests to verify they pass**

Run: `bun test tests/message-queue/types.test.ts tests/message-queue/queue.test.ts tests/message-queue/index.integration.test.ts tests/bot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator-types.ts src/message-queue/types.ts src/message-queue/queue.ts src/bot.ts tests/message-queue/types.test.ts tests/message-queue/queue.test.ts tests/message-queue/index.integration.test.ts tests/bot.test.ts
git commit -m "refactor(bot): queue attachment ids instead of raw files" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Move tools and `/clear` off the transient relay, then delete it

**Files:**

- Modify: `src/tools/upload-attachment.ts`
- Modify: `src/commands/clear.ts`
- Delete: `src/file-relay.ts`
- Modify: `tests/tools/attachment-tools.test.ts`
- Create: `tests/commands/clear.test.ts`
- Modify: `tests/bot.test.ts`

- [ ] **Step 1: Write the failing upload and clear tests**

```typescript
// tests/tools/attachment-tools.test.ts
import { listActiveAttachments, persistIncomingAttachments } from '../../src/attachments/index.js'
import { setupTestDb } from '../utils/test-helpers.js'

test('uploads file when attachmentId is found in the workspace', async () => {
  await setupTestDb()
  persistIncomingAttachments({
    contextId: CTX,
    sourceProvider: 'telegram',
    files: [{ fileId: 'platform-1', filename: 'photo.jpg', mimeType: 'image/jpeg', content: Buffer.from('img') }],
  })

  const uploadAttachment = mock(() =>
    Promise.resolve({ id: 'att-99', name: 'photo.jpg', url: 'https://example.com/photo.jpg' }),
  )
  const provider = createMockProvider({ uploadAttachment })
  const execute = getToolExecutor(makeUploadAttachmentTool(provider, CTX))
  const active = listActiveAttachments(CTX)

  const result = await execute({ taskId: 'task-1', attachmentId: active[0]!.attachmentId })

  expect(result).toEqual({ id: 'att-99', name: 'photo.jpg', url: 'https://example.com/photo.jpg' })
})

// tests/commands/clear.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { persistIncomingAttachments, listActiveAttachments } from '../../src/attachments/index.js'
import { registerClearCommand } from '../../src/commands/clear.js'
import {
  createMockChatWithCommandHandlers,
  createMockReply,
  createDmMessage,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('/clear Command', () => {
  let clearHandler: CommandHandler | null = null

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
    registerClearCommand(mockChat, () => true, 'admin-user')
    clearHandler = commandHandlers.get('clear') ?? null
  })

  test('clears attachment workspace together with history and memory', async () => {
    persistIncomingAttachments({
      contextId: 'clear-user',
      sourceProvider: 'telegram',
      files: [{ fileId: 'f1', filename: 'note.txt', content: Buffer.from('note') }],
    })

    const { reply, textCalls } = createMockReply()
    await clearHandler!(createDmMessage('clear-user', '/clear'), reply, {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'clear-user',
    })

    expect(listActiveAttachments('clear-user')).toEqual([])
    expect(textCalls[0]).toContain('attachments')
  })
})
```

- [ ] **Step 2: Run the upload and clear tests to verify they fail**

Run: `bun test tests/tools/attachment-tools.test.ts tests/commands/clear.test.ts tests/bot.test.ts`
Expected: FAIL because `makeUploadAttachmentTool` still expects `fileId`, `/clear` does not touch attachments, and `bot.test.ts` still contains relay-specific assertions

- [ ] **Step 3: Switch to workspace lookups, update `/clear`, and delete `file-relay.ts`**

```typescript
// src/tools/upload-attachment.ts
import { loadAttachmentRecord } from '../attachments/index.js'

export type UploadAttachmentStatus =
  | { status: 'attachment_not_found'; message: string }
  | { status: 'attachment_unavailable'; message: string }

async function executeUpload(
  provider: TaskProvider,
  contextId: string,
  taskId: string,
  attachmentId: string,
): Promise<unknown> {
  const record = loadAttachmentRecord(contextId, attachmentId)

  if (record === null) {
    return {
      status: 'attachment_not_found',
      message: `Attachment "${attachmentId}" is not available in this context.`,
    } satisfies UploadAttachmentStatus
  }

  const result = await provider.uploadAttachment!(taskId, {
    name: record.filename,
    content: record.content,
    mimeType: record.mimeType,
  })
  return result
}

inputSchema: z.object({
  taskId: z.string().describe('Task ID to attach the file to'),
  attachmentId: z.string().describe('Stable papai attachment ID from the current context'),
})

execute: async ({ taskId, attachmentId }) => executeUpload(provider, contextId, taskId, attachmentId)

// src/commands/clear.ts
import { clearAttachmentWorkspace } from '../attachments/index.js'

async function clearSelf(msg: { user: { id: string } }, reply: ReplyFn, auth: AuthorizationResult): Promise<boolean> {
  clearHistory(auth.storageContextId)
  clearSummary(auth.storageContextId)
  clearFacts(auth.storageContextId)
  clearAttachmentWorkspace(auth.storageContextId)
  await reply.text('Conversation history, memory, and attachments cleared.')
  return true
}

async function clearAll(msg: { user: { id: string } }, reply: ReplyFn): Promise<boolean> {
  const users = listUsers()
  for (const user of users) {
    clearHistory(user.platform_user_id)
    clearSummary(user.platform_user_id)
    clearFacts(user.platform_user_id)
    clearAttachmentWorkspace(user.platform_user_id)
  }
  await reply.text(`Cleared history, memory, and attachments for all ${users.length} users.`)
  return true
}

async function clearUser(msg: { user: { id: string } }, reply: ReplyFn, targetId: string): Promise<boolean> {
  clearHistory(targetId)
  clearSummary(targetId)
  clearFacts(targetId)
  clearAttachmentWorkspace(targetId)
  await reply.text(`Cleared history, memory, and attachments for user ${targetId}.`)
  return true
}

// delete src/file-relay.ts
```

- [ ] **Step 4: Run the upload and clear tests to verify they pass**

Run: `bun test tests/tools/attachment-tools.test.ts tests/commands/clear.test.ts tests/bot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/upload-attachment.ts src/commands/clear.ts tests/tools/attachment-tools.test.ts tests/commands/clear.test.ts tests/bot.test.ts
git rm src/file-relay.ts
git commit -m "refactor(attachments): replace file relay with workspace lookups" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Send multimodal attachment input to the LLM while keeping history text-safe

**Files:**

- Modify: `src/llm-orchestrator.ts`
- Modify: `src/llm-orchestrator-types.ts`
- Modify: `tests/llm-orchestrator.test.ts`

- [ ] **Step 1: Write the failing LLM test**

```typescript
// tests/llm-orchestrator.test.ts
import { persistIncomingAttachments } from '../src/attachments/index.js'
import type { ProcessMessageInput } from '../src/llm-orchestrator-types.js'

test('sends image parts to supported models but stores placeholder text in history', async () => {
  const attachmentCtx = 'attachment-ctx'
  seedConfigForContext(attachmentCtx)
  setCachedConfig(attachmentCtx, 'main_model', 'gpt-4o')

  const refs = persistIncomingAttachments({
    contextId: attachmentCtx,
    sourceProvider: 'telegram',
    files: [{ fileId: 'f1', filename: 'photo.jpg', mimeType: 'image/jpeg', content: Buffer.from('img') }],
  })

  let capturedMessages: unknown[] = []
  generateTextImpl = (args): Promise<GenerateTextResult> => {
    capturedMessages = args?.messages ?? []
    return defaultGenerateTextResult()
  }

  const { reply } = createMockReply()
  const input: ProcessMessageInput = {
    text: `What is shown in ${refs[0]!.attachmentId}?`,
    newAttachmentIds: refs.map((ref) => ref.attachmentId),
  }

  await processMessage(reply, attachmentCtx, null, input)

  const modelUserMessage = capturedMessages[capturedMessages.length - 1] as ModelMessage
  expect(Array.isArray(modelUserMessage.content)).toBe(true)
  expect(getCachedHistory(attachmentCtx)[0]?.content).toContain('[User attached')
})
```

- [ ] **Step 2: Run the LLM test to verify it fails**

Run: `bun test tests/llm-orchestrator.test.ts`
Expected: FAIL because `processMessage()` still expects a string and never sends multipart content

- [ ] **Step 3: Resolve attachments for the current turn, build multipart content, and persist placeholders**

```typescript
// src/llm-orchestrator.ts
import {
  buildHistoryAttachmentLines,
  listActiveAttachments,
  loadAttachmentRecord,
  selectAttachmentsForTurn,
  supportsAttachmentModelInput,
} from './attachments/index.js'
import type { ProcessMessageInput } from './llm-orchestrator-types.js'

const buildUserTurnMessages = (
  contextId: string,
  modelName: string,
  input: ProcessMessageInput,
): { modelMessage: ModelMessage; historyMessage: ModelMessage } => {
  const activeAttachments = listActiveAttachments(contextId)
  const selected = selectAttachmentsForTurn({
    text: input.text,
    newAttachmentIds: input.newAttachmentIds,
    activeAttachments,
  })

  const historyLines = buildHistoryAttachmentLines(selected)

  if (!supportsAttachmentModelInput(modelName)) {
    return {
      modelMessage: { role: 'user', content: [...historyLines, input.text].join('\n\n') },
      historyMessage: { role: 'user', content: [...historyLines, input.text].join('\n\n') },
    }
  }

  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: Buffer; mediaType?: string }
    | { type: 'file'; data: Buffer; filename?: string; mediaType: string }
  > = []

  for (const attachment of selected) {
    const record = loadAttachmentRecord(contextId, attachment.attachmentId)
    if (record === null) continue

    if ((record.mimeType ?? '').startsWith('image/')) {
      parts.push({ type: 'image', image: record.content, mediaType: record.mimeType })
    } else if (record.mimeType !== undefined) {
      parts.push({ type: 'file', data: record.content, filename: record.filename, mediaType: record.mimeType })
    }
  }

  parts.push({ type: 'text', text: input.text })

  return {
    modelMessage: { role: 'user', content: parts },
    historyMessage: { role: 'user', content: [...historyLines, input.text].join('\n\n') },
  }
}

export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  username: string | null,
  input: ProcessMessageInput,
  deps: LlmOrchestratorDeps = defaultDeps,
): Promise<void> => {
  const baseHistory = getCachedHistory(contextId)
  const mainModel = getConfig(contextId, 'main_model') ?? ''
  const { modelMessage, historyMessage } = buildUserTurnMessages(contextId, mainModel, input)
  const history = [...baseHistory, historyMessage]
  appendHistory(contextId, [historyMessage])

  try {
    const result = await callLlm(reply, contextId, username, [...baseHistory, modelMessage], deps)
    const assistantMessages = result.response.messages
    if (assistantMessages.length > 0) appendHistory(contextId, assistantMessages)
    if (shouldTriggerTrim([...history, ...assistantMessages])) {
      void runTrimInBackground(contextId, [...history, ...assistantMessages])
    }
  } catch (error) {
    saveHistory(contextId, baseHistory)
    await handleMessageError(reply, contextId, error)
  }
}
```

- [ ] **Step 4: Run the LLM test to verify it passes**

Run: `bun test tests/llm-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator.ts src/llm-orchestrator-types.ts tests/llm-orchestrator.test.ts
git commit -m "feat(llm): add multimodal attachment input" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Make Discord capability metadata truthful and run full verification

**Files:**

- Modify: `src/chat/discord/metadata.ts`
- Modify: `tests/chat/discord/metadata.test.ts`

- [ ] **Step 1: Write the failing Discord metadata test**

```typescript
// tests/chat/discord/metadata.test.ts
test('does not advertise files.receive until Discord maps inbound attachments', () => {
  expect(discordCapabilities.has('files.receive')).toBe(false)
  expect(discordCapabilities.has('messages.files')).toBe(true)
})
```

- [ ] **Step 2: Run the Discord metadata test to verify it fails**

Run: `bun test tests/chat/discord/metadata.test.ts`
Expected: FAIL because `discordCapabilities` still contains `files.receive`

- [ ] **Step 3: Remove the false-positive capability from Discord metadata**

```typescript
// src/chat/discord/metadata.ts
export const discordCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'interactions.callbacks',
  'messages.buttons',
  'messages.files',
  'messages.reply-context',
  'users.resolve',
])
```

- [ ] **Step 4: Run final verification**

Run: `bun run check:full && bun test tests/attachments tests/message-queue tests/commands/clear.test.ts tests/chat/discord/metadata.test.ts tests/chat/telegram/index.test.ts tests/chat/mattermost/index.test.ts`
Expected: PASS for repo checks, new attachment tests, queue tests, `/clear`, Discord metadata, and existing Telegram/Mattermost ingress guardrails

- [ ] **Step 5: Commit**

```bash
git add src/chat/discord/metadata.ts tests/chat/discord/metadata.test.ts
git commit -m "chore(attachments): align discord capability metadata" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
