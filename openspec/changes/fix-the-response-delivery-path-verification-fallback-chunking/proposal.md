# Proposal: fix-the-response-delivery-path-verification-fallback-chunking

## Why

Three bugs in the chat reply delivery path, reproduced live on 2026-09-06 via the in-process diagnostics buffers (issue #417 bugs 1–3). The verification pass returns empty on well-formed model answers, and that empty is treated as "no answer": a completed turn — six tool calls, a full 1611-char answer — was delivered as a generic 94-char stub. Separately, replies over the 4096-char platform limit fail delivery entirely and the user receives nothing. Users lose answers the model already produced.

## What Changes

- Empty verifier output is reinterpreted as **skip verification**: deliver the model's own text, log a warn, and record the verifier outcome (`ok` / `empty` / `error`) on the turn's trace record.
- The last-resort stub is demoted to turns with genuinely no model text; it must state what the bot tried (existing localized fallbacks already do).
- Chunked delivery for long replies on the adapters that lack it — Telegram and Kontur Talk (4096) and Mattermost (16383): split at the adapter's declared `maxMessageLength`, paragraph/line boundary first with a hard cut as fallback, chunks sent in order, and a chunk failure surfaced rather than silently dropping the remaining chunks.
- Edits confined to the modules listed under Impact; the risky-turn gate (`isRisky`) and the proactive path (`src/deferred-prompts/`, same builder) keep their shape.

Scope: applies to every platform instance (telegram, mattermost, discord, kontur-talk); no task instances involved. Delivery-only behavior, config-context-agnostic — no per-user / group-shared / thread-isolated state is read or written; stub localization follows the existing config-context locale.

## Capabilities

### New Capabilities

- `verified-completion`: verifier-pass semantics for the final reply — model text takes precedence over an empty or errored verifier result, when the stub is permitted, and the trace-recorded verifier outcome. Without it, any verifier blank or failure silently replaces real answers with a stub (bugs 1–2). No existing spec covers delivery or verification.
- `reply-chunking`: platform-safe delivery of over-limit replies — splitting, ordering, and per-chunk failure surfacing against each adapter's `maxMessageLength`. Without it, >4096-char replies vanish on Telegram and Kontur Talk (bug 3). Discord already chunks adapter-locally (`src/chat/discord/format-chunking.ts`, per chat conventions) and is not rewritten.

### Modified Capabilities

(none — no existing spec's requirements change)

## Non-goals

- Changing when verification runs (`isRisky` gate), or the verifier prompt/model/step bound.
- Retrying the verifier on empty output — empty means skip, not re-ask.
- A cross-platform shared formatter or rewrite of Discord chunking.
- Streaming/progressive delivery; compaction of long tool results (existing compaction untouched).
- Analytics DB schema changes — the verifier outcome lives in the in-process trace buffer only.

## Impact

- Code: `src/completion/verified-completion.ts`, `src/llm-orchestrator-send.ts` (+ wiring in `src/llm-orchestrator-support.ts`), `src/debug/llm-trace-collector.ts` (+ egress schema in `src/debug/schemas.ts`), and each Telegram / Mattermost / Kontur Talk adapter's `reply-helpers.ts` plus the deferred `sendMessage` in the Telegram and Kontur Talk `index.ts` — with a splitter sibling module next to the adapter (and the sequential chunk-send loop there too) wherever the `max-lines` cap demands it, per the Discord `format-chunking.ts` precedent (design D4).
- Docs: `docs/architecture/behaviors.md` — the verified-completion bullet (empty-verifier semantics, fallback precedence, chunked delivery).
- Tests: one reproducing test per bug, written first (tests/ conventions).
- No API, dependency, or config-schema changes.
