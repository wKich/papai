# Design: fix-the-response-delivery-path-verification-fallback-chunking

## Context

See `proposal.md` — Why for the incident (issue #417 bugs 1–3) and What Changes for scope. This design covers the how.

Current state that shapes every decision below:

- **One builder owns reply-text resolution on risky turns.** Both reply paths — interactive `sendLlmResponse` (`src/llm-orchestrator-send.ts`, `resolveFinalText`) and proactive `finalizeAndLog` (`src/deferred-prompts/proactive-llm-helpers.ts`) — call `buildVerifiedCompletion` (`src/completion/verified-completion.ts`). Today that function treats an empty verifier result and a thrown verifier identically: it returns the activity-selected last-resort stub (`neutralFallback` / `noopFallback`, en/ru via `src/i18n/`) with verdict `unconfirmed`, **discarding `turn.finalText`** — the model's own answer is never consulted on that branch. The `isRisky` gate (empty text ∨ `finishReason === 'tool-calls'` ∨ tool failure) already passes `finalText` into the turn object, so the fix is a precedence change inside the builder, and both paths inherit it for free.
- **`llm:end` fires before the verifier runs.** The trace record is pushed to the `recentLlm` ring (`src/debug/llm-trace-collector.ts`) from the `llm:end` event, which `invokeModel` emits (`src/llm-orchestrator-invoke.ts:187`) the moment the main generation resolves — the verification round-trip happens later, inside `sendLlmResponse`. A verifier outcome therefore cannot ride the existing `llm:end` payload without reordering the pipeline.
- **Chunking exists only on Discord.** `chunkForDiscord` (`src/chat/discord/format-chunking.ts`) splits at the adapter's `maxMessageLength` trait with fence balancing, and Discord's reply helpers send chunks sequentially. Telegram (`sendFormattedReply`, `reply-helpers.ts:217`; deferred `sendMessage`, `index.ts:140`), Mattermost (`createMattermostReplyFn.formatted`; `sendMattermostDeferredMessage`), and Kontur Talk (`createKonturTalkReplyFn`; deferred `sendMessage`, `index.ts:226`) each issue a **single** platform post, so anything over the limit (4096 / 16383 / 4096) fails whole.
- **Telegram formatting is entity-offset-based.** `formatLlmOutput(markdown)` produces text + entities with absolute offsets per message, and the deferred path prepends a mention prefix and shifts entity offsets. Chunking must therefore split the *markdown* and format each chunk independently.

Constraints: edits confined to `src/completion/verified-completion.ts`, `src/llm-orchestrator-send.ts`, verifier wiring in `src/llm-orchestrator-support.ts`, `src/debug/llm-trace-collector.ts` (+ the trace egress schema in `src/debug/schemas.ts`), and the three adapters' reply/deferred-send helpers. No new dependencies, no DB changes, no config-schema changes.

## Goals / Non-Goals

**Goals:**

- A completed turn's model text is deliverable verbatim even when the verifier pass blanks or errors; the stub becomes a true last resort (no model text at all) and keeps stating what the bot tried.
- The verifier outcome (`ok` / `empty` / `error`) is observable per turn in the in-process LLM trace buffer, joinable to the turn's existing trace record.
- Over-limit replies are delivered as ordered, platform-safe chunks on Telegram, Mattermost, and Kontur Talk, with per-chunk failure surfaced and remaining chunks still attempted.
- Both reply paths (interactive + proactive) get the delivery-semantics fix through the shared builder without changing their shape.

**Non-Goals** (design-level, beyond the proposal's):

- No reordering of the invoke → verify → send pipeline; the outcome attaches to the already-pushed trace instead.
- No proactive-path outcome *emission*: `finalizeAndLog`'s verification argument carries neither `turnId` nor `chatUserId` (its caller in `proactive-llm.ts` has both minted), and threading them through the proactive call chain would widen the edit set past the proposal's confinement. Proactive turns get the fixed delivery semantics (shared builder) but their traces keep `verifierOutcome: undefined` — the spec scopes outcome recording to interactive reply turns.
- No chunking of `reply.text`, `reply.buttons`, or file sends — only `formatted` and the deferred markdown sends (the surfaces that carry model answers).
- No multi-message `editReply`/`lastReplyTarget` redesign on Telegram/Mattermost; chunking keeps the existing single-ref reply-target shape.

## Decisions

### D1 — Empty/errored verifier means "skip verification"; model text takes precedence (bugs 1–2)

`buildVerifiedCompletion` keeps its single verification call and gains a three-way outcome. Resolution precedence for the delivered text:

1. Verifier returns non-empty text → deliver it (unchanged today), verdict = derived verdict, outcome `ok`.
2. Verifier returns empty **or throws** → log `warn`, outcome `empty` / `error`; deliver `turn.finalText` when it is non-empty **and** `finishReason !== 'tool-calls'`; verdict `unconfirmed` (the verifier did not confirm anything).
3. No usable model text → the existing activity-selected last-resort stub (`neutralFallback` after tool activity, `noopFallback` after none) — both already state what the bot tried, satisfying the "stub must say what was attempted" requirement without new strings.

`VerifiedCompletion` widens to `{ text, verdict, verifierOutcome: 'ok' | 'empty' | 'error' }` — the outcome is returned, not emitted from inside the builder, keeping the module pure and DI-testable.

**Preamble exception.** On a `tool-calls` finish the turn's text is a preamble ("let me check…"), never the answer — the proactive path already codifies this (`finalizeDeliveryText` drops it). So step 2 must not deliver `finalText` on truncated turns; the stub (or verifier text, when `ok`) remains the deliverable there. Without this guard the fix would leak preambles on every step-capped turn whose verifier blanks.

**Why in the builder, not in `resolveFinalText`:** both call paths share the builder; moving precedence into the interactive path would fix bug 1 for interactive turns only and duplicate the risky-gate logic. **Alternative rejected:** retrying the verifier on empty output — a non-goal (empty means skip, not re-ask) and it adds latency/cost to exactly the turns already degraded.

### D2 — Verifier outcome reaches the trace via a new `llm:verifier` event, matched by `turnId`

Because `llm:end` precedes verification (Context), the outcome is emitted when the verifier round-trip resolves and attached to the already-pushed trace:

- `LlmTrace` gains optional `turnId` (populated in `buildEndTrace` from the event; the pending already carries it) and optional `verifierOutcome`.
- `sendLlmResponse` emits `emitUser('llm:verifier', contextId, { chatUserId, outcome }, turnId)` when an outcome exists. The `Verification` argument widens to `{ verifier, history, turnId, chatUserId }`; `invokeWithLiveStatus` (`src/llm-orchestrator-support.ts`) has both at hand when it builds the verifier, so the wiring is one struct change. `resolveFinalText` returns `{ text, verifierOutcome? }` instead of a bare string.
- `handleLlmTraceEvent` handles `llm:verifier` by scanning `recentLlm` backwards for the newest trace with a matching `turnId` and setting `verifierOutcome` in place. `recentLlm` holds object references, so later reads (init payload, `/debug` polling, transcript viewer) see the field; a no-match event (e.g. the turn's trace was already evicted from the bounded ring) drops with a `debug` log — proactive turns emit no `llm:verifier` at all, so they never produce a no-match event.
- Anonymity: `shapeLlmTrace` keeps `verifierOutcome` for non-viewing admins — it is metadata like `finishReason`, carries no text. The egress `LlmTraceSchema` (`src/debug/schemas.ts`) gains the optional field for parity.
- Analytics is untouched by construction: `APPROVED_EVENT_TYPES` (`src/analytics/subscriber.ts`) does not include the new event type, matching the non-goal that the outcome lives in the in-process buffer only.

**Alternatives rejected:** moving `emitLlmEnd` after verification — reorders the pipeline and touches the invoke boundary for a diagnostics field; a side map keyed by `turnId` — splits the trace across two structures every reader must join.

### D3 — Chunking is adapter-local, in the `formatted` / deferred-send helpers (bug 3)

Each of the three adapters gets a small pure splitter next to its reply helpers (chat convention: "keep formatting and chunking helpers next to the adapter that needs them"; Discord is the precedent), and the send helpers loop over chunks. **Not** central chunking in `sendLlmResponse`: `maxMessageLength` is an adapter trait, `ReplyFn` deliberately hides platform detail, Discord already chunks adapter-locally (a central split would double-chunk it), and adapter-local chunking also covers non-orchestrator callers of `formatted`.

Split algorithm (per adapter, ~20 lines, exported for direct tests): if the text fits, one chunk; else cut at the last `\n\n` before the budget, else the last `\n`, else hard-cut at the budget — nudged one code unit left when the cut index would split a UTF-16 surrogate pair, so an astral character (emoji) is never orphaned into a message the platform API rejects; trim leading boundary newlines; repeat on the remainder. First-chunk budget is reduced by any prepended mention prefix (Telegram deferred, Mattermost deferred personal delivery) so `prefix + chunk` stays within the limit.

Adapter specifics:

- **Telegram** (`reply-helpers.ts` + deferred `sendMessage` in `index.ts`): split the markdown *before* `formatLlmOutput`, format each chunk independently (entity offsets are per-message), send chunks in order with identical reply parameters/thread id. The declared limit governs the **delivered** text, and `formatLlmOutput` is not length-preserving in either direction (`preprocessLists` inflates, marker stripping deflates), so chunks are budget-checked *after* formatting: a chunk whose formatted text — plus the mention prefix on the first chunk — still exceeds the limit is re-split from its markdown at a proportionally reduced budget and re-formatted, repeating until it fits (hard cut as the floor). `sendFormattedReply` returns the **first** chunk's `{ messageId, chatId }` so `lastReplyTarget`/`editReply` keep their single-ref shape; the deferred path shifts entity offsets only on the first chunk (prefix lands there).
- **Mattermost** (`reply-helpers.ts`): chunk in `formatted` via the existing `makePost`, same channel/thread; `lastReplyTarget` snapshots the first chunk's post id. `sendMattermostDeferredMessage` chunks after resolving the mention prefix, prefix counted against the first chunk.
- **Kontur Talk** (`reply-helpers.ts` + deferred `sendMessage` in `index.ts`): chunk in the `formatted` wrapper only — a markdown-format chunking variant of the internal `send` (one seam serves both formats today, and the plain `text` path keeps the unchunked `send`, honoring the `reply.text` Non-Goal) — and in the deferred post; plain sequential `/send_message` calls with the same `thread_id`.

Failure semantics (all three): send chunks strictly in order; a failed chunk logs `warn` with chunk index/count plus the conversation identifier in scope at the send site (Telegram `chatId`, Mattermost `channelId`, Kontur Talk `roomId` — passed explicitly, because the adapters' static logger children carry no context key) as the "identify the turn" context the spec requires, and is remembered; remaining chunks are **still attempted**; after the loop the first error is rethrown. This makes a mid-delivery failure non-silent (turn-level error handling and the log both surface it) while delivering whatever the platform accepted — strictly better than today's all-or-nothing failure. **Alternative rejected:** fail-fast abort — simpler, but silently drops the not-yet-attempted remainder, which the spec forbids.

**Deliberately excluded:** code-fence balancing (Discord's extra; the spec requires paragraph/line/hard-cut only — see Risks), threading follow-on Mattermost chunks under the first post (UX nicety, not required), and any shared cross-platform splitter (proposal non-goal; the adapters' formatting realities differ).

### D4 — No gating, scope, persistence, or dependency changes

- **Capability / tool-prefs:** no new tool surface; the verifier toolset (`selectReadOnlyTools`) and every permission gate are untouched.
- **Scope model:** no persisted state anywhere. The only new runtime datum (`verifierOutcome`) lives in the in-process `recentLlm` ring, attributed exactly like the existing trace fields (per-user via `chatUserId`/turn via `turnId`); nothing is keyed by storage/config context or platform instance.
- **DB:** no schema change, no drizzle migration, no backfill.
- **Dependencies:** none — the splitters are pure string operations; the outcome event rides the existing event bus; the existing modules cover each need (builder for precedence, event bus + trace collector for observability, adapter reply helpers for delivery). Where an adapter helper file sits against the 300-line pedantic `max-lines` cap (Telegram's `reply-helpers.ts` is at 298 lines), the splitter — and the sequential chunk-send loop, where the cap demands it — lands in a sibling module next to the adapter instead, per the Discord precedent (`src/chat/discord/format-chunking.ts`): "no new modules" means no new dependencies and no new areas, not that near-cap files must absorb code. Sequential chunk sends use Discord's `pLimit(1)` pattern, since `no-await-in-loop` is enforced for `src/`.

### D5 — Test-first order and hook interactions

All edited files are under `src/` and gateable by `isGateableImplFile`; each already has a covering suite, so the write hook's TDD nudge never fires — the reproducing tests are *added to the existing suites first*, watched red, then the fix lands (test + fix = one unit, per the task contract):

1. **Bug 1+2 semantics** — `tests/completion/verified-completion.test.ts`: verifier empty/throw with `finalText` present delivers `finalText` with verdict `unconfirmed`; `tool-calls` finish does not deliver the preamble; no-model-text rows keep the stub matrix (existing rows already cover turns without `finalText` and stay green unchanged).
2. **Bug 1 end-to-end** — `tests/llm-orchestrator-send.test.ts`: risky turn (tool failure, non-empty model text) + verifier returning `''` → the mock reply receives the model text, and the `llm:verifier` event carries `empty`.
3. **Bug 2 trace** — `tests/debug/llm-trace-collector.test.ts`: `llm:end` then `llm:verifier` (same `turnId`) → the pushed trace ends with `verifierOutcome` set; unknown `turnId` → no match, nothing thrown.
4. **Bug 3** — per adapter in `tests/chat/{telegram,mattermost,kontur-talk}/reply-helpers.test.ts` (+ `index.test.ts` for the two deferred sends): over-limit input → ordered chunks each ≤ limit, boundaries at paragraph/line, hard cut for unbroken text; first-chunk prefix allowance; a failing chunk still leaves later chunks attempted and rethrows, and the failure warn carries the adapter's conversation identifier (`chatId`/`channelId`/`roomId`) with chunk index/count.

Mutation ratchet note: the new branches (outcome precedence, preamble guard, split boundaries, first-chunk reserve, continue-then-rethrow) are exactly what the per-file floor will measure — the tests above must assert each side of every branch, not just the happy path.

Docs: the `verified-completion` bullet in `docs/architecture/behaviors.md` (line ~82) is updated for the new precedence, outcome field, and chunked delivery as part of the change, not this design.

## Risks / Trade-offs

- [Verifier outcome misses the live `llm:full` WS broadcast (trace already shipped when the outcome lands)] → visible on every subsequent read (init/poll); acceptable for a diagnostics buffer, and the alternative is a pipeline reorder this change forbids.
- [Chunk split lands inside a code fence or an inline span (bold/italic/link) on the three adapters] → renders as literal backticks or stray `**`/`[` markers but still delivers; fence and span balancing are deliberately out (spec asks paragraph/line/hard-cut; Discord keeps its own). Revisit only if users report it.
- [Back-to-back chunk sends can trip platform rate limits (Telegram allows ≈1 message/s per chat and ~20/min per group; no grammy retry transformer is wired today)] → a 429 surfaces as a chunk failure through the per-chunk failure path, not a silent drop. This modestly amplifies the single-send path's pre-existing exposure; pacing is out of scope here — revisit if 429s are observed.
- [Continue-on-chunk-failure can deliver a partial answer followed by the turn error reply] → honest and non-silent; the warn log carries chunk index/count for diagnosis.
- [A partially failed chunked deferred delivery leaves the prompt due, so the scheduled/alert pollers re-run generation and re-deliver the previously succeeded chunks on each retry] → the pollers finalize only on fully successful delivery (`src/deferred-prompts/poller.ts` gates `finalizeAllPrompts`/`recordProofGroupDelivery` on `delivered`; `poller-alerts.ts` has the same shape), and both they and any real fix (delivery receipts) are outside this change's edit set. Accepted: today's whole-message failure delivers nothing at all, the turn error reply plus the per-chunk warn surface the failure, and duplication is bounded by the prompt's retry cadence. Revisit if repeated partial answers are observed.
- [`lastReplyTarget`/`editReply` now address only the first chunk on Telegram/Mattermost] → shape-preserving choice; a regeneration edit revises the head message. Multi-chunk editing is a follow-up (Discord's all-chunks pattern is the model), out of scope here.
- [Existing suites pin the old stub-on-empty behavior] → those rows construct turns *without* `finalText`, which still stub; verified by inspection — additions only, plus one one-line rewrite: the `confirmed` row's whole-shape `toEqual` (tests/completion/verified-completion.test.ts:268) gains `verifierOutcome: 'ok'`. The empty/throw rows assert `.text`/`.verdict` only, so they stay green unchanged.
- [Proactive turns show no verifier outcome in traces] → explicit non-goal (D2/Non-Goals); reads as "verifier not run", never as a wrong outcome.

## Migration Plan

Single deploy, no flags, no data steps: the precedence change, the new trace field, and chunking are all code-local and take effect on the next turn after restart. Old traces in the ring simply lack `verifierOutcome` (optional field, every reader treats it as absent). Rollback is `git revert` of the change commit — no state to unwind. Post-deploy verification: the debug LLM trace for a tool-bearing risky turn shows `verifierOutcome`, and a reply whose delivered text exceeds 4096 chars — on Telegram, the formatted delivery, since formatting can deflate a >4096-char markdown source to a single within-limit message — arrives as multiple ordered messages on Telegram/Kontur Talk.

## Open Questions

- Should the debug/transcript UI render `verifierOutcome` (badge/column), or is the JSON field enough for now? Deferrable — the buffer + schema land first either way.
- Should Mattermost follow-on chunks thread under the first post's `root_id` for readability? Pure UX follow-up; flat sequential posts meet the spec.
- Should Telegram `editReply` eventually edit every chunk of the prior reply (Discord's pattern)? Only matters once regeneration-after-long-reply is observed in practice.
