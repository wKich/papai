# File Attachments Design: Shared Attachment Pipeline

**Date:** 2026-04-11  
**Status:** Approved  
**Scope:** Platform-agnostic attachment ingestion, durable attachment persistence, LLM-visible files, tool-visible files, and migration away from transient current-turn relay state

## Problem Statement

papai already has partial incoming-file support, but it is split across several layers and only one of the main use cases is fully wired today.

1. **Telegram and Mattermost already ingest incoming files** into `IncomingMessage.files`, and the bot already carries those files through queueing.
2. **Tool usage exists, but only for the current turn**. `upload_attachment` depends on the transient in-memory `file-relay` and exposes platform `fileId` values in prompt text.
3. **LLM usage does not exist yet**. `llm-orchestrator.ts` still sends string-only user messages and never hydrates attachments into `ImagePart` or `FilePart`.
4. **History cannot safely hold binary content**. Conversation history is stored as JSON text, and trim/summarization logic assumes text-first messages.
5. **The design must fit the provider-capability-architecture migration**. Telegram, Mattermost, and future Discord support should converge on a shared contract instead of adding more provider-name branches.

The result is an awkward split: chat adapters own file bytes, the prompt builder only exposes metadata, tools only see the latest turn, and the LLM cannot reason over the files themselves.

## Goals

1. Make incoming attachments first-class for both **LLM understanding** and **tool workflows**.
2. Define a **platform-agnostic attachment contract** that Telegram and Mattermost can adopt first and Discord can adopt later.
3. Persist attachments **until the user clears them**.
4. Keep attachment persistence **separate from conversation history** so history stays text-safe and trim-safe.
5. Align the design with the existing **capability-shaped provider architecture**.
6. Support graceful degradation when file download, persistence, or model attachment support fails.

## Non-Goals

- Introducing external object storage or CDN delivery in this phase.
- Building a rich attachment-management UI in the first pass.
- Automatically re-sending every stored attachment to the model on every turn.
- Backfilling old history rows into the new attachment workspace.
- Requiring Discord implementation in the first pass; Discord is a compatibility target, not a delivery requirement.

## Current State

The approved design starts from the real codebase state, not from the older research assumptions.

| Area          | Current reality                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Chat contract | `IncomingMessage.files` and `IncomingFile` already exist in `src/chat/types.ts`.                                        |
| Telegram      | `src/chat/telegram/index.ts` and `file-helpers.ts` already download incoming document/photo/audio/video/voice files.    |
| Mattermost    | `src/chat/mattermost/index.ts` and `file-helpers.ts` already fetch metadata and bytes for `file_ids`.                   |
| Bot flow      | `src/bot.ts` already queues files and stores them in `file-relay.ts` before calling the LLM.                            |
| Prompting     | `buildPromptWithReplyContext()` only exposes attachment metadata and transient `fileId` values.                         |
| Tools         | `upload_attachment` can upload a file from the current message only, using `file-relay.ts` as the source of truth.      |
| LLM           | `processMessage()` and `llm-orchestrator.ts` are string-only.                                                           |
| History       | Conversation history is persisted as JSON text and should remain binary-free.                                           |
| Discord       | The provider advertises `files.receive`, but `mapDiscordMessage()` does not yet map attachments into `IncomingMessage`. |

That means the design problem is not "how do we add incoming files at all?" but rather "how do we turn today's fragmented file path into a shared attachment pipeline?"

## Design

### 1. Shared Attachment Subsystem

Add a new `src/attachments/` module that owns attachment persistence and lookup for the rest of the application.

```text
src/
├── attachments/
│   ├── types.ts
│   ├── ingest.ts
│   ├── store.ts
│   ├── workspace.ts
│   └── resolver.ts
```

| Component                 | Responsibility                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AttachmentIngestService` | Accept raw incoming files from chat adapters, normalize metadata, persist content, and return stable attachment refs.     |
| `AttachmentStore`         | Own metadata persistence and blob reads/writes.                                                                           |
| `AttachmentWorkspace`     | Track stored attachments and the active attachment set for each conversation context.                                     |
| `AttachmentResolver`      | Convert attachment refs into LLM parts, tool inputs, or text placeholders depending on runtime support and failure state. |

This is the key boundary shift:

- **Chat providers** receive platform files.
- **Attachments module** becomes the durable source of truth.
- **Bot and queue** operate on attachment refs instead of raw buffers after ingestion.
- **LLM and tools** consume the same shared refs.

### 2. Data Model

Introduce a stable papai-level attachment identity that replaces platform `fileId` as the long-lived identifier.

```typescript
type AttachmentRef = {
  attachmentId: string
  contextId: string
  filename: string
  mimeType?: string
  size?: number
  status: 'available' | 'tool_only' | 'rejected' | 'unavailable'
}

type StoredAttachment = AttachmentRef & {
  sourceMessageId?: string
  sourceProvider: 'telegram' | 'mattermost' | 'discord' | 'unknown'
  sourceFileId?: string
  checksum: string
  blobPath: string
  createdAt: string
  clearedAt?: string
  lastUsedAt?: string
}
```

`AttachmentRef` is safe to surface in prompts, queues, and history placeholders. `StoredAttachment` stays internal to the attachment subsystem.

### 3. Attachment Workspace Model

Each storage context gets an **attachment workspace** with two layers:

1. **Stored attachments** - every attachment persisted for that context until cleared.
2. **Active attachment set** - the attachments the bot should treat as currently in play.

Behavior:

- Newly received attachments are stored immediately and added to the active set.
- The active set persists across turns.
- Later turns do **not** automatically rehydrate every stored file into model input.
- Instead, later turns see a compact manifest of active attachments, and the resolver hydrates only the attachments relevant for that turn.

This preserves the user expectation of "keep the files around until I clear them" without turning every future LLM call into an unbounded multimodal replay.

### 4. Persistence Model

Persist attachment metadata in SQLite and persist binary content in a blob store on disk.

| Storage layer        | Contents                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| SQLite               | `attachmentId`, `contextId`, provider/source metadata, filename, mime type, size, checksum, timestamps, status, active/cleared state |
| Blob store           | Raw attachment bytes addressed by attachment ID; checksum is stored for integrity checks and future dedupe work                      |
| Conversation history | Text placeholders and attachment refs only, never raw bytes                                                                          |

This keeps history and trim logic safe:

- No `Uint8Array` or base64 payloads in conversation JSON
- No binary blobs in trim prompts
- No need to serialize `ImagePart` or `FilePart` back into history storage

### 5. Intake and Queue Flow

The queue should stop being the first durable owner of attachment bytes.

New flow:

1. Chat adapter receives message and downloads platform bytes into `IncomingFile`.
2. Bot intake persists those files immediately through `AttachmentIngestService`.
3. Queue stores `attachmentId[]` alongside queued text, not raw buffers.
4. Coalescing merges text and attachment refs from rapid-fire messages in the same context.
5. LLM processing resolves attachment refs on demand.

This moves persistence ahead of debounce and ahead of the LLM call, which is important because the user explicitly wants attachments to survive until clear.

### 6. Prompt and History Behavior

`buildPromptWithReplyContext()` should stop surfacing transient platform IDs like:

```text
[Attached files available for upload_attachment (use fileId): ...]
```

Instead, it should render a compact attachment manifest using papai attachment refs:

```text
[Available attachments: att_123 design.pdf (application/pdf), att_124 screenshot.jpg (image/jpeg)]
```

History storage should use placeholder text plus attachment refs, for example:

```text
[User attached att_123: design.pdf]
```

The placeholder is the persisted history representation. The actual bytes stay in the attachment workspace.

### 7. LLM Integration

`processMessage()` and the orchestrator should move from a string-only input to a structured turn input that can include text plus attachment refs.

Conceptually:

```typescript
type ProcessMessageInput = {
  text: string
  attachmentIds: string[]
}
```

Resolver outcomes:

| Outcome         | Behavior                                                                            |
| --------------- | ----------------------------------------------------------------------------------- |
| `model + tool`  | Hydrate the ref into `ImagePart` or `FilePart` and keep the ref available to tools. |
| `tool_only`     | Keep the attachment in workspace and surface a text placeholder to the model.       |
| `metadata_only` | Attachment could not be downloaded/persisted; surface failure metadata only.        |

Rules:

- Images become `ImagePart` when model support is available.
- Documents and other files become `FilePart` when supported.
- Unknown model attachment capability defaults to `tool_only`; do not optimistically send binary parts to unclassified models.
- Unsupported or risky cases fall back to text placeholders instead of failing the whole turn.
- The LLM receives only the attachment content chosen for the current turn, not every stored file in the workspace.

### 8. Tool Integration

Tools should resolve attachments through the shared attachment workspace instead of the transient `file-relay`.

#### `upload_attachment`

Change the long-lived interface from platform `fileId` to papai `attachmentId`:

```typescript
inputSchema: z.object({
  taskId: z.string(),
  attachmentId: z.string(),
})
```

Behavior:

- Load attachment bytes from the workspace by `attachmentId`
- Upload through the capability-gated task provider attachment API
- Return a clear error if the attachment was cleared or unavailable

#### Migration behavior

To reduce churn during rollout:

- adapters may still emit `IncomingFile`
- `file-relay.ts` can remain temporarily as a compatibility shim
- once all tool paths resolve `attachmentId` from the attachment workspace, `file-relay.ts` should be removed

### 9. Clear Behavior

In v1, `/clear` should clear the attachment workspace along with conversation history and memory for the same storage context.

This satisfies the user requirement that attachments remain available until the user clears them, without forcing a second management surface into the initial rollout.

Deferred:

- selective attachment removal
- attachment listing commands
- pin/unpin controls distinct from the active set

### 10. Capability Alignment

This design must not add new provider-name branching.

Alignment rules:

- **Chat providers** continue to advertise `files.receive`.
- **Telegram and Mattermost** become the first concrete implementations of the shared ingest contract.
- **Discord** implements the same ingest contract later instead of creating a separate downstream path.
- **Task provider upload behavior** stays capability-gated via `attachments.upload`.

This keeps the architecture consistent with the existing provider-capability migration: provider surfaces declare what they can do, and the rest of the app consumes normalized behavior.

### 11. Error Handling and Degradation

Attachment failure handling is **per file**, not all-or-nothing per message.

| Scenario                          | Behavior                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------- |
| Download failure                  | Mark the attachment `unavailable`, continue with text and remaining attachments |
| File too large                    | Mark the attachment `rejected`, surface the reason in the manifest              |
| Persistence failure               | Surface metadata-only failure state and continue the turn                       |
| Unsupported model attachment type | Downgrade to `tool_only` placeholder behavior                                   |
| Missing blob on later use         | Return explicit error for that attachment, do not fail unrelated attachments    |

This keeps the system honest and resilient without hiding failures behind silent fallbacks.

### 12. Testing Strategy

The design needs explicit coverage at four levels.

1. **Attachment service unit tests**
   - ingest
   - clear behavior
   - metadata/blob consistency
   - active-set behavior
2. **Prompt and orchestrator tests**
   - manifest rendering
   - multipart hydration
   - placeholder downgrade behavior
   - history-safe placeholder persistence
3. **Tool-path tests**
   - `upload_attachment` loads persisted refs instead of relay state
   - missing/cleared attachment errors are explicit
4. **Adapter and integration tests**
   - Telegram and Mattermost normalize to the same ingest contract
   - queued/coalesced messages preserve attachment refs correctly
   - Discord attachment mapping can be added later without changing orchestrator or tool contracts

## Design Summary

The recommended design is a **shared attachment pipeline**:

- adapters receive raw files
- papai persists them immediately into a durable attachment workspace
- the rest of the app uses stable attachment refs instead of platform `fileId`s
- the LLM hydrates only the attachments needed for the current turn
- tools use the same refs for uploads and other actions
- `/clear` resets the workspace

This is the smallest design that satisfies all approved requirements:

- first-class LLM use
- first-class tool use
- persistence until clear
- history-safe storage
- Telegram/Mattermost first
- Discord-compatible later
- provider-capability-architecture alignment
