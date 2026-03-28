# Research: Audio & Video Message Support

Research into adding support for handling and responding to audio/video messages from chat platforms.

## Current State

The bot is **text-only** end-to-end. No incoming media of any kind is processed.

| Layer                  | Current State                                             |
| ---------------------- | --------------------------------------------------------- |
| `IncomingMessage` type | `text: string` only — no media fields                     |
| Telegram adapter       | Listens to `'message:text'` only                          |
| Mattermost adapter     | Post schema captures `message` only, no `file_ids`        |
| LLM orchestrator       | `{ role: 'user', content: string }` — no multimodal parts |
| History storage        | `ModelMessage[]` as JSON — text only                      |

Existing research on general file attachments is in `docs/file-attachments-research.md`. This document focuses specifically on **audio and video** message types and the unique challenges they present.

## Audio/Video Message Types by Platform

### Telegram

| Type       | Filter Query         | Key Properties                                                        | Typical MIME              | Notes                                             |
| ---------- | -------------------- | --------------------------------------------------------------------- | ------------------------- | ------------------------------------------------- |
| Voice note | `message:voice`      | `file_id`, `duration`, `mime_type`, `file_size`                       | `audio/ogg` (Opus codec)  | Recorded in-app, circular waveform UI             |
| Audio file | `message:audio`      | `file_id`, `duration`, `mime_type`, `file_size`, `title`, `performer` | `audio/mpeg`, `audio/mp4` | Forwarded music/podcasts                          |
| Video      | `message:video`      | `file_id`, `duration`, `width`, `height`, `mime_type`, `file_size`    | `video/mp4`               | Standard video files                              |
| Video note | `message:video_note` | `file_id`, `duration`, `width`, `height`, `file_size`                 | `video/mp4`               | Circular "telescope" videos, no `mime_type` field |

**File download flow:**

```
ctx.api.getFile(file_id) → File { file_path } → fetch(`https://api.telegram.org/file/bot${token}/${file_path}`)
```

- Download links valid for **1 hour**
- **20MB hard limit** on bot file downloads (server-side)
- Grammy has no built-in download helper — must `fetch()` manually
- Media messages use `ctx.message.caption` for text, not `ctx.message.text`

### Mattermost

- Posts include `file_ids: string[]` for any attached files
- Metadata: `GET /api/v4/files/{fileId}/info` → includes `name`, `size`, `mime_type`
- Content: `GET /api/v4/files/{fileId}` → raw bytes
- 2 HTTP calls per file add latency

## Strategies for Audio/Video Processing

There are three fundamentally different approaches, each with different trade-offs:

### Strategy A: Speech-to-Text Transcription (Recommended for v1)

Convert audio to text before sending to the LLM — the bot continues to operate in text mode.

**How it works:**

```
User sends voice note → Download audio bytes → Transcribe via STT API → Send text to LLM
```

**STT Provider Options:**

| Provider           | API                             | Audio Formats                             | Max Duration        | Cost (approx)           |
| ------------------ | ------------------------------- | ----------------------------------------- | ------------------- | ----------------------- |
| OpenAI Whisper API | `POST /v1/audio/transcriptions` | mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg | 25 min              | $0.006/min              |
| Groq Whisper       | Same OpenAI-compatible API      | Same formats                              | 25 min              | $0.02/hr (~$0.0003/min) |
| Local Whisper      | Self-hosted                     | All ffmpeg formats                        | Unlimited           | Free (CPU/GPU cost)     |
| Deepgram           | REST API                        | Most formats                              | Streaming supported | $0.0043/min             |

**Why this is recommended for v1:**

- The bot is a **task management** assistant — voice messages almost always contain instructions ("create a task for...", "what's the status of...")
- Text transcription preserves the full pipeline: tools, history, trimming all work unchanged
- No multimodal LLM required — works with any text model
- Conversation history stays text-only (no storage bloat)
- Cheapest option — Groq Whisper is nearly free

**Implementation sketch:**

```typescript
// New: src/transcription.ts
export async function transcribeAudio(
  audioData: Uint8Array,
  mimeType: string,
  config: { apiKey: string; baseUrl?: string },
): Promise<string> {
  const formData = new FormData()
  formData.append('file', new Blob([audioData], { type: mimeType }), 'audio.ogg')
  formData.append('model', 'whisper-1')

  const response = await fetch(`${config.baseUrl ?? 'https://api.openai.com'}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: formData,
  })

  const result = await response.json()
  return result.text
}
```

**New per-user config keys:**

- `stt_baseurl` — STT API base URL (default: same as `llm_baseurl`)
- `stt_apikey` — STT API key (default: same as `llm_apikey`)
- `stt_model` — STT model name (default: `whisper-1`)

**User experience:**

```
User: [sends 15-second voice note]
Bot:  🎤 Transcribed: "Create a task to review the Q3 budget report by Friday"
      ✅ Task created: "Review Q3 budget report" (due: Friday)
```

### Strategy B: Native Multimodal (Audio Parts)

Send raw audio bytes directly to a multimodal LLM that supports audio input.

**How it works:**

```
User sends voice → Download bytes → Send as FilePart to LLM → LLM processes audio natively
```

**AI SDK v6 support:**

```typescript
const message: ModelMessage = {
  role: 'user',
  content: [
    { type: 'file', data: audioBytes, mediaType: 'audio/ogg', filename: 'voice.ogg' },
    { type: 'text', text: 'The user sent this voice message.' },
  ],
}
```

**Pros:**

- Preserves tone, emphasis, speaker identity
- Can handle non-speech audio (music, environmental sounds)
- Single API call

**Cons:**

- Requires a multimodal model that supports audio input (GPT-4o, Gemini 1.5 Pro — but NOT most open-source models)
- Since the bot uses `@ai-sdk/openai-compatible` with configurable providers, most users' models likely **don't** support audio input
- Audio tokens are expensive (~$0.06/min for GPT-4o audio)
- History serialization is problematic — can't store audio bytes in SQLite JSON
- Breaks conversation trimming (text-based token counting doesn't work for audio)

**Verdict:** Not recommended for v1 due to provider compatibility issues. Could be a future opt-in mode.

### Strategy C: Video Frame Extraction + Transcription

For video messages, extract key frames as images and audio track as text.

**How it works:**

```
User sends video → Download → Extract audio → Transcribe
                            → Extract key frames → Send as ImageParts to LLM
```

**Requires:** ffmpeg (or similar) for frame extraction and audio demuxing.

**Pros:**

- Rich understanding of video content

**Cons:**

- Heavy dependency (ffmpeg)
- Complex pipeline
- Most video messages in a task bot context are accidental or screen recordings where audio transcription alone suffices

**Verdict:** Overkill for v1. Audio transcription covers 95% of use cases.

## Recommended Implementation Plan

### Phase 1: Voice Message Transcription (STT)

**Scope:** Telegram voice notes and audio files → transcribe → process as text.

**Changes required:**

| File                                 | Change                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `src/chat/types.ts`                  | Add `attachments?: IncomingAttachment[]` to `IncomingMessage`               |
| `src/chat/telegram/index.ts`         | Register handlers for `message:voice`, `message:audio`; download file bytes |
| `src/chat/telegram/file-download.ts` | New: download file from Telegram API by `file_id`                           |
| `src/transcription.ts`               | New: OpenAI-compatible STT API client                                       |
| `src/bot.ts`                         | If message has audio attachments, transcribe before passing to LLM          |
| `src/config.ts`                      | Add `stt_baseurl`, `stt_apikey`, `stt_model` config keys                    |
| `src/commands/config.ts`             | Show STT config keys in `/config` output                                    |

**New types:**

```typescript
type IncomingAttachment = {
  type: 'audio' | 'video' | 'image' | 'document'
  data: Uint8Array
  mimeType: string
  filename: string
  /** Duration in seconds (audio/video only) */
  duration?: number
}
```

**Message flow with transcription:**

```
Voice note → Telegram adapter downloads bytes → IncomingMessage.attachments
  → bot.ts detects audio attachment
  → transcribeAudio(attachment.data, attachment.mimeType)
  → prepend "[Voice message transcription]: {text}" to message
  → processMessage() handles it as normal text
```

**Graceful degradation:**

- If STT API key not configured: reply "Voice messages require STT configuration. Use `/set stt_apikey <key>` to enable."
- If download fails: reply "Could not download voice message. Please try sending as text."
- If transcription fails: reply "Could not transcribe voice message. Please try again or send as text."

### Phase 2: Video Message Support

**Scope:** Extract audio from video messages, transcribe, optionally send thumbnail to vision model.

**Additional changes:**
| File | Change |
|------|--------|
| `src/chat/telegram/index.ts` | Register handlers for `message:video`, `message:video_note` |
| `src/bot.ts` | For video attachments, extract and transcribe audio track |

**Options for audio extraction from video:**

1. **Send entire video file to Whisper** — Whisper API accepts `mp4` and extracts audio automatically. Simplest approach.
2. **Use ffmpeg** — Extract audio track before sending. More efficient for large videos but adds a system dependency.
3. **Thumbnail only** — Send video thumbnail as an image to a vision model. Loses audio content.

**Recommendation:** Option 1 (send mp4 to Whisper) for simplicity. Whisper handles mp4 natively.

### Phase 3: Native Multimodal (Future)

**Scope:** For users with multimodal-capable models, send audio/video directly as `FilePart`.

**Gated by:** A new config key `multimodal_mode: 'transcribe' | 'native'` (default: `transcribe`).

**Changes:**

- In `src/llm-orchestrator.ts`, when `multimodal_mode === 'native'`, build multi-part content instead of transcribing
- Replace binary data with text placeholder before storing in history
- Add token budget awareness for media parts in trimming logic

## Responding with Audio/Video

### Text-to-Speech (TTS) Responses

The bot could optionally respond with voice messages instead of text.

**OpenAI TTS API:**

```typescript
const response = await fetch(`${baseUrl}/v1/audio/speech`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'tts-1', input: text, voice: 'alloy' }),
})
const audioBuffer = await response.arrayBuffer()
```

**Telegram voice reply:**

```typescript
import { InputFile } from 'grammy'
await ctx.replyWithVoice(new InputFile(new Uint8Array(audioBuffer), 'response.ogg'))
```

**When to use TTS:**

- Only when the user sent a voice message (mirror the input modality)
- Controlled by config: `tts_enabled: true/false`, `tts_voice: 'alloy' | 'echo' | ...`
- Always include text as caption for accessibility

**New config keys:**

- `tts_enabled` — Enable voice responses (default: `false`)
- `tts_baseurl` — TTS API base URL
- `tts_apikey` — TTS API key
- `tts_model` — TTS model (default: `tts-1`)
- `tts_voice` — Voice selection (default: `alloy`)

**Implementation:** Add `voice` method to `ReplyFn`:

```typescript
export type ReplyFn = {
  // ... existing methods
  voice?: (audio: Uint8Array, caption?: string, options?: ReplyOptions) => Promise<void>
}
```

### Video Responses

Not recommended. The bot is text/task-oriented. Generating video responses would require:

- Video generation models (expensive, slow)
- No clear use case for task management

## Mattermost Considerations

Mattermost doesn't have native voice/video messages in the same way as Telegram, but users can attach audio/video files. The same transcription pipeline applies:

1. Extend `MattermostPostSchema` to include `file_ids`
2. On incoming post, check file metadata for audio/video MIME types
3. Download and transcribe audio/video attachments
4. Process as text

## Cost & Performance Estimates

| Operation                                  | Latency   | Cost                               |
| ------------------------------------------ | --------- | ---------------------------------- |
| Download voice note (Telegram, ~30s audio) | 100-300ms | Free                               |
| Whisper transcription (30s audio)          | 1-3s      | ~$0.003 (OpenAI) / ~$0.0002 (Groq) |
| TTS response (100 words)                   | 500ms-1s  | ~$0.003 (OpenAI)                   |
| LLM processing (text, as today)            | 2-5s      | Varies by provider                 |

**Total added latency for voice→text→voice round trip:** ~3-6s on top of normal LLM processing.

## Summary

| Phase   | Scope                           | Complexity              | Dependencies                       |
| ------- | ------------------------------- | ----------------------- | ---------------------------------- |
| Phase 1 | Voice/audio → transcribe → text | Medium                  | STT API (OpenAI-compatible)        |
| Phase 2 | Video → transcribe audio track  | Low (on top of Phase 1) | Same STT API (Whisper handles mp4) |
| Phase 3 | Native multimodal to LLM        | High                    | Multimodal-capable LLM             |
| TTS     | Text → voice response           | Medium                  | TTS API (OpenAI-compatible)        |

**Recommended starting point:** Phase 1 (voice transcription) — it covers the primary use case, requires no multimodal LLM, preserves the entire existing pipeline, and is cheapest to operate.
