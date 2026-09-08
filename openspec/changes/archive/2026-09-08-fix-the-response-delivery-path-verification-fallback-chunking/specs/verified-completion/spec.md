## Purpose

Governs how the final user-facing reply is chosen on turns that run a verification pass: an empty or failed verifier never discards an already-generated answer, when a generic stub may be delivered, and how the verifier outcome is recorded for diagnostics.

## ADDED Requirements

### Requirement: Delivered text precedence on verified turns

On any turn that runs a verification pass, the delivered reply SHALL be chosen by precedence: first, the verification pass's own text when it returns non-empty usable text; otherwise the turn's own final model text when it is non-empty; otherwise the last-resort stub. Here "final model text" excludes step-capped preamble text: on a `tool-calls` finish reason the turn was cut off mid-tool-step and its text is a preamble ("let me check…"), never the answer — the precedence falls through to the last-resort stub (or to the verified text, when the pass returned usable text) rather than delivering the preamble. An empty or failed verification result SHALL be treated as "no verdict", never as "no answer". These rules change only which text is delivered, not when a verification pass runs. The precedence SHALL hold identically on every platform instance (Telegram, Mattermost, Discord, Kontur Talk), for member, admin, and guest users alike, on both the reply path and the proactive/deferred prompt path, and in every storage and config context — delivery reads no per-user, group-shared, or thread-isolated state.

#### Scenario: Empty verifier result with a generated answer

- **WHEN** a completed turn executes several tool calls and produces a full-length final answer, and the verification pass returns empty text
- **THEN** the user receives the model's full answer text and no generic stub is sent

#### Scenario: Verification error with a generated answer

- **WHEN** the verification pass fails with an error while the turn produced non-empty final model text
- **THEN** the model's text is delivered

#### Scenario: Successful verification still delivers the verified text

- **WHEN** the verification pass returns non-empty usable text
- **THEN** that verified text is delivered

#### Scenario: Step-capped turn does not deliver its preamble

- **WHEN** a turn ends with a `tool-calls` finish reason having produced only preamble text such as "let me check…", and the verification pass returns empty or fails
- **THEN** the preamble is not delivered as the answer; the last-resort stub is delivered instead

#### Scenario: Identical precedence on the proactive path

- **WHEN** a proactive (deferred) turn produces final model text and its verification pass returns empty or errors
- **THEN** the model's text is delivered under the same precedence as an ordinary reply turn

### Requirement: Empty verifier output means skip verification

An empty verification output SHALL be interpreted as "skip verification": the system delivers the turn's final model text when present (preamble scoping per the delivered-text precedence requirement), logs a warning, and issues no second verification request for the turn. An empty verifier output SHALL NEVER by itself cause the answer to be replaced, truncated, or withheld.

#### Scenario: Well-formed answer with empty verifier output

- **WHEN** the verification pass returns empty text on a turn with a well-formed model answer
- **THEN** the model answer is delivered unchanged and a warning is logged

#### Scenario: No verifier retry on empty output

- **WHEN** the verification pass returns empty text
- **THEN** no additional verification request is issued for that turn

### Requirement: Last-resort stub only when no model text exists

On a turn that runs a verification pass, a generic stub reply SHALL be delivered only when the turn produced no non-empty final model text — where "final model text" carries the delivered-text precedence requirement's scoping, so step-capped (`tool-calls`-finish) preamble text does not count as model text. Whenever delivered, the stub SHALL state what the bot tried to do — distinguishing a turn that executed tool actions from one that executed none — and SHALL be localized to the turn's config-context locale. The stub SHALL NOT be a bare acknowledgment such as "Done.".

#### Scenario: Stub after tool activity

- **WHEN** a turn executed at least one tool, produced no final model text, and verification returned empty or failed
- **THEN** the delivered stub states that actions were performed, in the turn's config-context locale

#### Scenario: Stub with no tool activity

- **WHEN** a turn executed no tools, produced no final model text, and verification returned empty or failed
- **THEN** the delivered stub states that nothing was executed

#### Scenario: No stub when model text exists

- **WHEN** a turn produced non-empty final model text, regardless of the verifier outcome
- **THEN** no generic stub is delivered

### Requirement: Verifier outcome recorded on the trace record

Every interactive reply turn that runs a verification pass SHALL have the outcome recorded on that turn's record in the in-process LLM trace buffer as exactly one of: `ok` (usable text returned), `empty` (empty text returned), or `error` (the pass failed). Proactive/deferred turns run the same verification pass and the same delivery precedence, but outcome recording is out of scope for them: their trace records carry no verifier outcome, which reads as "verifier not run", never as a wrong outcome. The recorded outcome SHALL be observable through the LLM-trace diagnostics surface and SHALL NOT include credentials, tokens, or other secrets.

#### Scenario: Outcome ok

- **WHEN** a verification pass returns non-empty usable text
- **THEN** the turn's trace record shows verifier outcome `ok`

#### Scenario: Outcome empty

- **WHEN** a verification pass returns empty text
- **THEN** the turn's trace record shows verifier outcome `empty`

#### Scenario: Outcome error

- **WHEN** a verification pass fails with an error
- **THEN** the turn's trace record shows verifier outcome `error`
