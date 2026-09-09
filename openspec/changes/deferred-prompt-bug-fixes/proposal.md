# Revision to deferred-prompt-bug-fixes — bug-1 proof-check redesign after the 2026-09-09 live record

## Evidence being captured (maintainer live record, admin DM, 2026-09-09 evening)

- `no_tools` variant — PASS: run `74ed88fb`, marker `[[proof-check:74ed88fb]]` echoed byte-for-byte, `finish_reason: stop`, no tools. Bug 1's mechanism did not reproduce without tools; the execution→delivery seam is in sync on the non-risky path.
- `with_tool_probe` variant — run `4f51643e` (23:00:42→23:02:19): generated **empty string** (`finish_reason: stop`), fallback stub delivered, marker absent. Diagnosis: generation itself failed; repro narrowed to **tool-attach ⇒ empty generation**, matching the known empty-response bug owned by change `response-delivery-path-fixes` (#417, PR #419) — fresh fact cross-posted there by the maintainer.
- Implication: the `finalizeAndLog` lane "tool failure ⇒ risky ⇒ discard good text" (src/deferred-prompts/proactive-llm-helpers.ts:182-193, 228-247) was **not exercised** — no good text was ever generated, so nothing was discarded. Bug 1 remains unproven live.
- **New finding implied by the record:** `bug1Verdict` (src/deferred-prompts/proof-checks-observe.ts:165-187) is **vacuous**. For run `4f51643e` it computes `expected = finalizeDeliveryText({text: '', finishReason: 'stop'})` → the same fallback stub that was delivered → `delivered === expected` → mechanical verdict **PASS**, while proving nothing about bug 1. The maintainer read it as FAIL by intent (expected marker never generated). A tool-attached variant that produces empty text and delivers the stub must never record pass.

## Goal

Make `bug1_delivery_matches_execution` (`with_tool_probe`) actually capable of proving bug 1's lane — good text generated, probe tool call fails, text still delivered verbatim — impossible to satisfy vacuously, and sequence its live gate behind the upstream empty-generation fix.

## Files to touch

- `src/deferred-prompts/proof-checks-observe.ts` — harden `bug1Verdict` with a risky-good-text precondition (below). No change to `bug1Verdict`'s equality comparison itself.
- `tests/` — verdict unit tests for the precondition (new cases + any existing bug1 verdict tests extended).
- `openspec/changes/deferred-prompt-bug-fixes/proposal.md` + `tasks.md` (source of truth on branch `agent/issue-401`) — record the 2026-09-09 evidence and the dependency note in the Bug 1 section/verification steps.
- **Not touched:** `proactive-llm-helpers.ts` (bug 1's fix lane is unchanged), `proof-checks-prompts.ts` (the probe design — echo marker, then call `web_fetch` against the dead port — is already the "produce good text, then provoke the tool failure" variant; it was starved by the upstream bug, not misdesigned), and the other four bugs' lanes.

## Intended behaviour change

1. **Verdict precondition (harness only):** `bug1Verdict` may return `pass` only when all hold: (a) `trace.generatedText` is non-empty and contains the run's marker; (b) at least one entry in `trace.toolCalls` has `success: false` (the probe tool failure actually happened); (c) a delivery record exists and `delivered.responseText === finalizeDeliveryText(...)`. If (a) or (b) fails, verdict is **`inconclusive`** (never pass, never fail) with explicit observations — `precondition_unmet: empty_generation` (when text is empty, add a pointer to the upstream `response-delivery-path-fixes` #417 dependency), `precondition_unmet: marker_absent`, `precondition_unmet: no_failed_tool` — plus the already-recorded `finish_reason`/`generated_text`/`failed_tools` lines. Rationale: an inconclusive ledger entry says "this run proved nothing" without polluting the fail ledger with another change's bug; the maintainer's human FAIL reading stays in the recorded evidence note.
2. **Sequencing dependency (docs + tasks):** bug 1's live proof gate is blocked by the tool-attach empty-generation bug (#417, PR #419). Bug 1's **code MR is not blocked** — the unit red test (good text + `finishReason: 'stop'` + injected tool failure → text delivered verbatim, verifier not called) is fully controllable and proceeds as planned. Only the live `with_tool_probe` pass record waits until #419 is in prod; the final cleanup MR already requires all five pass records, which enforces the wait — the tasks must state this so nobody forces the proof early.
3. **Evidence record (docs):** append the 2026-09-09 record summarized above (both variants, run ids, diagnosis, cross-post note) to the change folder as the bug-3-style observations trail for bug 1.

## Verification

1. Unit tests on the hardened verdict: (i) empty generation + fallback delivered ⇒ `inconclusive` with `precondition_unmet: empty_generation` (regression for the vacuous pass of run `4f51643e`); (ii) marker-less good text + failed tool ⇒ `inconclusive`; (iii) good text, no failed tool ⇒ `inconclusive`; (iv) good marker-bearing text + failed tool + delivered===expected ⇒ `pass`; (v) missing delivery record stays `inconclusive`.
2. Full `bun run test` + `bun check:full` before the MR.
3. Live: after `response-delivery-path-fixes` (#419) lands in prod, re-run `bug1_delivery_matches_execution` both variants; `with_tool_probe` records pass only under the full precondition; bug 1's MR completes when that pass record exists.

## Non-goals

- No change to bug 1's fix itself, to `finalizeDeliveryText`/`finalizeAndLog` semantics, or to the probe prompt design.
- No work on the empty-generation bug here — it belongs to `response-delivery-path-fixes` (#417, PR #419); this change only records the dependency.
- No change to the other four bugs' lanes or their proof checks.

## Capabilities

None — skip_specs proposed because the revision touches only the disposable proof-check harness's verdict logic and the change's own documentation/evidence records; no downstream-visible system contract delta is intended.
