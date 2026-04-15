# YouTrack Bulk Command Confirmation Design

## Summary

Tighten `apply_youtrack_command` so it always requires confirmation when a command targets more than one issue. This preserves the current low-friction behavior for single-issue allowlisted commands while closing the remaining bulk-mutation safety gap in the tool.

## Context

The current `apply_youtrack_command` tool already requires confirmation for:

- command text outside the small safe allowlist
- commands that add a `comment`
- commands that run with `silent: true`

However, it still allows otherwise-safe commands like `for me`, `vote`, and `star` to execute immediately across multiple issues.

This is a real risk because YouTrack's commands API is explicitly bulk-oriented: the request body accepts a collection of issues, and JetBrains documents applying one command to one or more issues in a single request. A mistaken issue selection can therefore produce an unconfirmed bulk mutation.

## Decision

Always require confirmation when `taskIds.length > 1`.

This rule applies regardless of whether the command text is otherwise allowlisted.

## Goals

- Never execute a multi-issue YouTrack command without explicit confirmation.
- Preserve current direct execution for single-issue allowlisted commands with no extra side effects.
- Keep the fix local, small, and easy to reason about.
- Cover the new behavior with focused regression tests.

## Non-Goals

- No `/confirm` or `/reject` command flow.
- No changes to the provider transport layer or the YouTrack API integration.
- No changes to the shared confidence threshold in `src/tools/confirmation-gate.ts`.
- No redesign of the tool builder or bot/orchestrator confirmation UX.
- No expansion of the safe-command allowlist.

## Scope

Files in scope:

- `src/tools/apply-youtrack-command.ts`
- `tests/tools/youtrack-command.test.ts`

Files out of scope unless unexpected evidence appears during implementation:

- `src/providers/youtrack/operations/commands.ts`
- `src/tools/confirmation-gate.ts`
- `src/tools/tools-builder.ts`

## Design

### Execution Behavior

`apply_youtrack_command` keeps the current direct-execution model. The tool will continue to either:

- return `{ status: 'confirmation_required', message }`, or
- call `provider.applyCommand(...)`

No new outward response shapes are introduced.

### Confirmation Rules

The confirmation decision in `src/tools/apply-youtrack-command.ts` should be updated so confirmation is required when any of the following are true:

- `taskIds.length > 1`
- `comment !== undefined`
- `silent === true`
- the command text is outside the existing single-issue safe allowlist

This means:

- `for me` on one issue may still run immediately
- `for me` on three issues must require confirmation
- `vote` on one issue may still run immediately
- `vote` on two issues must require confirmation
- `for me` on one issue with a comment must require confirmation

### Internal Structure

Keep one local confirmation gate function in `src/tools/apply-youtrack-command.ts`.

The implementation should stay minimal: add the bulk-scope rule to the existing tool-local policy instead of introducing a new abstraction layer. This is a narrow behavioral fix, and the file is still small enough for the rule set to remain readable in one place.

### Confirmation Message

The confirmation message should continue to describe the intended action using the existing `checkConfidence(...)` flow.

The action description must include the bulk scope explicitly, for example:

- `Apply YouTrack command "for me" to 3 issue(s)`

If additional side effects are present, the existing suffix behavior remains, for example:

- `Apply YouTrack command "for me" to 3 issue(s) (with a comment)`
- `Apply YouTrack command "vote" to 2 issue(s) (without notifications)`

## Testing Strategy

Follow TDD for the change.

Add or update focused tests in `tests/tools/youtrack-command.test.ts` for at least these cases:

1. single-issue allowlisted command still executes without confirmation
2. multi-issue allowlisted command returns `confirmation_required`
3. confirmed multi-issue allowlisted command forwards successfully
4. confirmation message includes the correct multi-issue count
5. existing comment and silent safeguards still behave as before

No provider-layer test changes are expected for this fix because the provider request contract does not change.

## Risks And Mitigations

### Risk: accidental behavior drift for single-issue safe commands

Mitigation:

- keep existing single-issue regression tests unchanged
- add one explicit bulk-vs-single contrast in the tool test suite

### Risk: confirmation text no longer fully describes the action

Mitigation:

- assert message content in the new bulk confirmation test
- keep the action description generation in one place inside the tool file

## Acceptance Criteria

- Any `apply_youtrack_command` call with `taskIds.length > 1` requires confirmation unless the user has already provided high-confidence confirmation.
- Single-issue allowlisted commands retain current direct-execution behavior when `comment` and `silent` are absent.
- Existing blocked cases for non-allowlisted commands, comments, and silent execution still work.
- Focused tool tests cover the new bulk confirmation behavior.
