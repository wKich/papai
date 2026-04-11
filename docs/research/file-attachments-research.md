# File Attachments Research

Research into adding support for incoming file attachments from chat platforms.

## Current State

| Aspect                           | Status                                                   |
| -------------------------------- | -------------------------------------------------------- |
| **Outgoing files** (bot -> user) | Supported (both Telegram & Mattermost)                   |
| **Incoming files** (user -> bot) | Not supported                                            |
| **AI SDK multi-part content**    | SDK v6 supports it, but the bot only uses string content |

### Current Message Flow (Text Only)

```
User sends photo/document -> ChatProvider ignores it -> IncomingMessage has text only
                                                         -> LLM gets { role: 'user', content: string }
```

## What Needs to Change (5 Layers)

### 1. `src/chat/types.ts` — Extend `IncomingMessage`

- `IncomingMessage` has no file/attachment properties.
- `ChatFile` exists but is outgoing-only (`Buffer | string` + `filename`).
- Need a new incoming attachment type with: `mimeType`, `data` (`Uint8Array`), `filename`, `fileSize`.

### 2. Telegram Adapter (`src/chat/telegram/index.ts`)

- Currently only listens to `'message:text'` events.
- Needs to also listen to `'message:photo'`, `'message:document'`, `'message:voice'`, `'message:video'`, etc.
- Must use `ctx.api.getFile(file_id)` to get a `File` object, then construct the download URL: `https://api.telegram.org/file/bot<token>/<file_path>`.
- Download link is valid for **1 hour** only.
- Grammy has **no built-in download helper** — must `fetch()` the bytes manually.
- Extract `ctx.message.caption` as the text content for media messages (not `ctx.message.text`).

### 3. Mattermost Adapter (`src/chat/mattermost/`)

- `MattermostPostSchema` doesn't capture `file_ids`.
- Need to extend the schema, then fetch file metadata and content:
  - `GET /api/v4/files/{fileId}/info` — metadata (name, size, mime_type)
  - `GET /api/v4/files/{fileId}` — raw bytes
- Authentication: same `Bearer ${this.token}` pattern already used.
- Follows the existing `apiFetch` / `uploadFile` patterns in the adapter.

### 4. LLM Orchestrator (`src/llm-orchestrator.ts`)

- Currently creates `{ role: 'user', content: userText }` (string-only).
- Needs to build multi-part content blocks when attachments are present:
  ```typescript
  { role: 'user', content: [
    { type: 'image', image: uint8Array, mediaType: 'image/png' },
    { type: 'text', text: 'What does this show?' }
  ]}
  ```
- The Vercel AI SDK v6 supports `ImagePart`, `FilePart`, and `TextPart` in `UserContent`.

### 5. History / Storage (`src/cache.ts`, `src/db/schema.ts`)

- Conversation history stored as JSON text in SQLite.
- Binary file data should **not** be persisted in history.
- Recommendation: send files to the LLM once, then replace with a text placeholder like `[Image: filename.png]` for history storage.

## AI SDK v6 Content Part Types

### UserContent

```typescript
type UserContent = string | Array<TextPart | ImagePart | FilePart>
```

### TextPart

```typescript
interface TextPart {
  type: 'text'
  text: string
}
```

### ImagePart

```typescript
interface ImagePart {
  type: 'image'
  image: DataContent | URL // DataContent = string | Uint8Array | ArrayBuffer | Buffer
  mediaType?: string
}
```

### FilePart

```typescript
interface FilePart {
  type: 'file'
  data: DataContent | URL
  filename?: string
  mediaType: string // required
}
```

## Telegram Media Type Metadata

| Type      | `file_name` | `mime_type` | `file_size` | Notes                                                 |
| --------- | ----------- | ----------- | ----------- | ----------------------------------------------------- |
| PhotoSize | No          | No          | Optional    | Array of resolutions; pick the largest (last element) |
| Document  | Optional    | Optional    | Optional    | Full metadata available                               |
| Voice     | No          | Optional    | Optional    | Has `duration`                                        |
| Video     | Optional    | Optional    | Optional    | Has `width`, `height`, `duration`                     |
| Audio     | Optional    | Optional    | Optional    | Has `duration`, `performer`, `title`                  |

## Potential Caveats

### 1. Telegram 20MB File Size Limit (hard, server-side)

Telegram Bot API only allows downloading files **up to 20MB**. `ctx.api.getFile(file_id)` returns a `File` object with `file_path`. There is no way around this limit for regular bots.

### 2. History Serialization of Binary Data

If `ImagePart` uses raw `Uint8Array`, `JSON.stringify()` produces a massive array of numbers (`[137, 80, 78, 71, ...]`), bloating SQLite storage. Options:

- Use base64 strings (simple but bloated).
- **Don't persist image content at all** (recommended) — replace with a text placeholder after the LLM call.

### 3. Conversation Trimming Doesn't Understand Images

`memory.ts` builds a text representation of history for the trim LLM:

```typescript
;`${i}: [${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`
```

An `ImagePart` would serialize to `[{"type":"image","image":"<huge base64>"}]`, which would blow up the trim prompt's token budget. **Must replace image content with a placeholder before it enters history**, not after.

### 4. `ImagePart` vs `FilePart` — Different Semantics and Provider Support

- `ImagePart`: for vision-capable models (images only).
- `FilePart`: for document/file processing (PDF, text, etc.).

Not all LLM providers support both. Since the bot uses a **configurable** LLM provider via `@ai-sdk/openai`, there's no guarantee the user's model supports vision. Need graceful degradation — if the model doesn't support vision or download fails, include a text note like "User attached an image but the current model doesn't support vision."

### 5. Telegram Photos Have No MIME Type

`PhotoSize` objects only contain `file_id`, `file_unique_id`, `width`, `height`, and optional `file_size`. **No `mime_type` field.** Must assume `image/jpeg` (Telegram compresses photos to JPEG) or inspect the downloaded bytes.

### 6. Caption vs Text — Different Text Fields for Media Messages

When a user sends a photo/document with a caption, the text is in `ctx.message.caption`, **not** `ctx.message.text`. The current adapter reads `ctx.message?.text`. Media-only messages (no caption) should still be processed.

### 7. Multiple Photos Per Message (Media Groups)

Telegram sends photos as an array of `PhotoSize` objects (different resolutions of the same image) — pick the last/largest. But Telegram also supports **media groups** (multiple photos in one album), which arrive as **separate `message` events** with the same `media_group_id`. Handling media groups correctly is complex. Simplest approach for v1: treat each message independently, ignore `media_group_id`.

### 8. Mattermost File IDs Require Separate API Calls

Mattermost posts include `file_ids: string[]` but no file content. Need:

1. `GET /api/v4/files/{fileId}/info` — metadata
2. `GET /api/v4/files/{fileId}` — raw bytes

That's **2 extra HTTP calls per file**, adding latency for messages with multiple attachments.

### 9. File Download Failures

File downloads are async and can fail (network error, expired link, file too large). Need to handle:

- Download failure gracefully (proceed with text-only and notify user).
- Timeout on downloads.
- Partial failures (3 of 4 images download ok — send what we have).

### 10. Token Budget Impact

A single image can consume 1000+ tokens (depending on provider and resolution). With conversation history potentially containing multiple images across turns, context limits can be hit quickly. The trim logic doesn't account for image token costs since it operates on text indices only.

## Recommended Approach

1. **Don't persist images in history** — send to LLM once, then replace with `[Image: filename.png]` placeholder immediately.
2. **Add a `files` field to `IncomingMessage`** with `{ data: Uint8Array, mimeType: string, filename: string }`.
3. **Download files in each adapter** (before entering the message handler), so `bot.ts` gets a clean `IncomingMessage` with bytes already resolved.
4. **Graceful degradation** — if the model doesn't support vision or download fails, include a text note explaining the limitation.
5. **Skip media groups for v1** — handle one image per message, ignore `media_group_id`.
6. **Enforce file size limits** — check `file_size` metadata before downloading.

## Key Files to Modify

| File                              | Change                                                    |
| --------------------------------- | --------------------------------------------------------- |
| `src/chat/types.ts`               | Add incoming attachment type to `IncomingMessage`         |
| `src/chat/telegram/index.ts`      | Listen for media events, download files via `getFile()`   |
| `src/chat/mattermost/schema.ts`   | Add `file_ids` to post schema                             |
| `src/chat/mattermost/index.ts`    | Fetch file content from Mattermost API                    |
| `src/llm-orchestrator.ts`         | Build multi-part content blocks for the AI SDK            |
| `src/bot.ts`                      | Pass attachments through the message handling pipeline    |
| `src/cache.ts` / `src/history.ts` | Store text placeholders instead of binary data in history |
