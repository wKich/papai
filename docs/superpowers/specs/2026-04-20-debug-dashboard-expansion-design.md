# Debug Dashboard Expansion — Design

- Date: 2026-04-20
- Status: Approved (pre-plan)
- Scope owner: bot admin (`ADMIN_USER_ID`), sole consumer

## 1. Problem

The current debug dashboard (`src/debug/*`, `client/debug/*`) surfaces sessions, wizards, scheduler/poller/message-cache indicators, aggregate stats, LLM traces, and structured logs. It does **not** expose large parts of the bot's internal state that the admin routinely needs when investigating incidents:

- memo lifecycle (create / update / archive / promote / search)
- recurring tasks and deferred prompts — current next-fire time, last-fire outcome, pause state, skipped/alerted occurrences
- what the bot actually said to the user (reply text, reply target, typing heartbeat)
- per-turn transitions (queue → dequeue → orchestrator → tool request → confirmation → execution → result → reply) as one cohesive object
- group / identity / auth context (authorized groups, group-settings target, identity mappings, file-relay turn contents, active config-editor and wizard sessions)
- tool-failure / error-analysis outcomes as first-class records
- log cross-linking from a specific session / trace / turn / reminder

In addition, the existing filter (`isAdminEvent` in `src/debug/state-collector.ts`) only filters events that carry a string `userId`; group-scoped and unscoped events pass through. With richer data sources this becomes a privacy concern, so the dashboard must strictly expose only the admin's personal data plus data from groups where the admin is a member.

## 2. Users and stories

Sole user: the bot admin.

1. Inspect a user's memos (active / archived / promoted) and observe memo lifecycle events live.
2. See every active recurring task and deferred prompt with next-fire time, last-fire outcome, pause state, skipped/alerted occurrences.
3. Watch a live timeline of notifications / outgoing replies (scheduler-fired tasks, deferred-prompt alerts, typing heartbeats, reply content + reply target).
4. Observe transitions inside a single turn — queue → dequeue → orchestrator → tool request → confirmation → execution → result → reply — with timings and per-step state.
5. See authorized groups, group-settings target, identity mappings, file-relay turn contents, active config-editor and wizard sessions.
6. Have tool-failure and error analysis surfaced as first-class events (reason code, retriable classification).
7. Filter logs by the currently selected session / trace / turn / reminder without re-searching.
8. Dashboard shows only the admin's own state and groups where the admin is a group member (`authorized-groups` ∩ `isGroupMember(..., ADMIN_USER_ID)`), enforced at the collector rather than the UI.

## 3. Architecture overview

Three cross-cutting changes form the spine; every story is additive on top.

### 3.1 Typed emit helpers

Replace bare `emit()` with scope-explicit helpers in `src/debug/event-bus.ts`:

```ts
type Scope =
  | { kind: 'user'; userId: string }
  | { kind: 'group'; groupId: string; threadId?: string }
  | { kind: 'global' }

emitUser(type, userId, data, turnId?)
emitGroup(type, groupId, data, turnId?, threadId?)
emitGlobal(type, data)
```

Every new and migrated emit site uses these helpers. The helpers inject a top-level `__scope` field (and optional `turnId`) onto the event envelope. Bare `emit()` remains for the deprecation window but defaults to `{ kind: 'global' }` and logs a one-shot warning per event type.

### 3.2 Admin-visibility allow-list

Computed once per SSE connection and cached on the collector:

```ts
type AdminVisibility = {
  adminUserId: string
  groupIds: ReadonlySet<string> // listAuthorizedGroups() ∩ isGroupMember(g, admin)
}
```

Recomputed when the collector sees `auth:group_authorized`, `auth:group_revoked`, `group_member:added`, or `group_member:removed`. No polling, no TTL.

### 3.3 Turn correlation

`turnId = crypto.randomUUID()` is minted at the `src/message-queue/` boundary — the exact point where coalesced incoming messages become one orchestrator invocation. Two envelope events bracket the timeline:

- `turn:start` — with the constituent incoming message ids and trigger kind
- `turn:end` — with status (`ok | error | cancelled`) and totals

`turn:end` is emitted from a `finally` so stalled runs still close. `turnId` is threaded as a parameter through orchestrator, tool execution, confirmation, and reply — no module reads it, they only forward it.

### 3.4 Shape

```
source modules ── emitUser / emitGroup / emitGlobal ──► event-bus
                                                           │ (+ __scope, turnId)
                                                state-collector
                                   (admin-visibility filter, default-deny)
                             ┌─────────┼─────────────────────┐
                        snapshot on    SSE stream        ring buffers
                         state:init                  (turns, notifications,
                             │           │            tool-failures)
                             ▼           ▼                   │
                         REST /resources for lazy drill-down
                             └───────────┬───────────────────┘
                                     dashboard
```

Existing infrastructure (SSE server, log buffer, dashboard HTML shell, modal/tree-view renderers) is reused; nothing is rewritten.

## 4. Event catalog

All new events ride the existing SSE channel. `turnId` is a top-level envelope field when relevant.

| Story | Event type                                                                                                                                     | Scope                   | Notes                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| 4     | `turn:start`, `turn:end`                                                                                                                       | user or group           | minted at message-queue; payload incl. incoming message ids, trigger kind                        |
| 4     | `queue:enqueue`, `queue:dequeue`, `queue:coalesce`                                                                                             | user or group           | from `src/message-queue/`                                                                        |
| 4     | `tool:request`, `tool:confirm_required`, `tool:confirm_result`, `tool:execute_start`, `tool:execute_end`                                       | carries `turnId`        | detailed view; `llm:tool_call` / `llm:tool_result` stay for LLM-trace back-compat                |
| 3     | `reply:sent`                                                                                                                                   | user or group           | text, reply-target thread/msg id, length, duration — supersedes today's opaque `message:replied` |
| 3     | `typing:start`, `typing:stop`                                                                                                                  | user or group           | from `src/reply-typing-heartbeat.ts`                                                             |
| 3     | `notify:scheduler_fired`, `notify:deferred_alert`                                                                                              | user or group           | what the user actually saw                                                                       |
| 1     | `memo:created`, `memo:updated`, `memo:archived`, `memo:promoted`, `memo:searched`                                                              | user                    |                                                                                                  |
| 2     | `recurring:created`, `recurring:updated`, `recurring:paused`, `recurring:resumed`, `recurring:skipped`, `recurring:deleted`, `recurring:fired` | user or group           |                                                                                                  |
| 2     | `deferred:created`, `deferred:updated`, `deferred:cancelled`, `deferred:fired`, `deferred:alerted`                                             | user or group           |                                                                                                  |
| 5     | `identity:set`, `identity:cleared`                                                                                                             | user                    |                                                                                                  |
| 5     | `file_relay:attached`, `file_relay:consumed`, `file_relay:dropped`                                                                             | user, `turnId`          |                                                                                                  |
| 5     | `group_settings:target_changed`, `config_editor:opened`, `config_editor:step`, `config_editor:closed`                                          | user                    |                                                                                                  |
| 5     | `auth:group_authorized`, `auth:group_revoked`, `group_member:added`, `group_member:removed`                                                    | group                   | triggers allow-list recompute                                                                    |
| 6     | `tool:failure_classified`                                                                                                                      | user or group, `turnId` | from `src/tool-failure.ts` / `src/error-analysis.ts`, reason code, retriable flag                |

Explicit non-events (out of scope for this expansion): web-fetch cache internals, embeddings calls, announcements internals.

## 5. Admin-scope filter

One filter function is applied to every event before any state update or broadcast:

```ts
function isVisibleToAdmin(event, vis): boolean {
  const s = event.__scope
  if (s.kind === 'global') return true
  if (s.kind === 'user') return s.userId === vis.adminUserId
  if (s.kind === 'group') return vis.groupIds.has(s.groupId)
  // unscoped legacy emit() → deny (with one-shot warn log per type)
  return false
}
```

Snapshots on `state:init` are filtered symmetrically through a shared helper `applyVisibility(entries, getScope)` so the rule lives in one place. REST endpoints for lazy drill-down accept `?userId=` or `?groupId=` and reject out-of-allow-list requests with `403`.

The current `isAdminEvent` logic (pass when `userId` field is absent) is removed — default-deny for anything unscoped means new source modules cannot silently leak.

## 6. Per-resource data plan

Hybrid delivery: ambient-monitoring data arrives eagerly in `state:init`; drill-down content is fetched lazily over REST; every resource emits live events.

| Resource                                      |                  init snapshot                   |                          REST endpoint                           |               Live events                |
| --------------------------------------------- | :----------------------------------------------: | :--------------------------------------------------------------: | :--------------------------------------: |
| Sessions (existing)                           |                        ✓                         |                                —                                 |                `cache:*`                 |
| Wizards (existing)                            |                        ✓                         |                                —                                 |                `wizard:*`                |
| Scheduler / pollers / msg-cache (existing)    |                        ✓                         |                                —                                 | `scheduler:*`, `poller:*`, `msgcache:*`  |
| Turns                                         | ✓ compact (id, scope, status, started, duration) |                         `/turns/:turnId`                         | `turn:*`, `queue:*`, `tool:*`, `reply:*` |
| Recurring tasks                               |                    ✓ compact                     |         `/recurring?userId=…` or `/recurring?groupId=…`          |              `recurring:*`               |
| Deferred prompts                              |                    ✓ compact                     |          `/deferred?userId=…` or `/deferred?groupId=…`           |               `deferred:*`               |
| Notifications timeline                        |              ✓ last N (ring, 2048)               |                                —                                 |   `notify:*`, `reply:sent`, `typing:*`   |
| Tool failures                                 |              ✓ last N (ring, 1024)               | `/tool-failures?userId=…` or `/tool-failures?groupId=…` (future) |        `tool:failure_classified`         |
| Memos                                         |                        —                         |       `/memos?userId=…&state=active` or `&state=archived`        |                 `memo:*`                 |
| Identity map                                  |                        —                         |                       `/identity?userId=…`                       |               `identity:*`               |
| File-relay turn contents                      |                        —                         |                      `/file-relay?turnId=…`                      |              `file_relay:*`              |
| Group settings target, config-editor sessions |             ✓ compact (active only)              |                                —                                 |  `group_settings:*`, `config_editor:*`   |
| Admin allow-list view                         |                        ✓                         |                                —                                 |        `auth:*`, `group_member:*`        |

New in-memory buffers inside the state collector:

- `recentTurns` — 512 entries
- `recentNotifications` — 2048 entries
- `recentToolFailures` — 1024 entries

New source-module getters (mirroring today's `getSessionSnapshots` pattern), each accepting `AdminVisibility`:

- `getRecurringSnapshot(vis)` in `src/recurring.ts`
- `getDeferredSnapshot(vis)` in `src/deferred-prompts/`
- `getConfigEditorSnapshot(vis)` in `src/config-editor/`
- `getGroupSettingsSnapshot(vis)` in `src/group-settings/`
- `getAdminAllowlistSnapshot(adminUserId)` in `src/debug/`

REST endpoints are added to `src/debug/server.ts`, share the `isAuthorizedRequest` token gate, and additionally call `assertScopeAllowed(vis, params)`.

## 7. Turn-timeline mechanics

### 7.1 Propagation

```
messageQueue.flush(turnId, messages)
  └─ orchestrator.run({ turnId, … })
       ├─ emitUser('llm:start', userId, {…}, turnId)
       ├─ tools.execute({ turnId, … })
       │    ├─ emit('tool:request', …, turnId)
       │    ├─ emit('tool:confirm_required', …, turnId)   (if gated)
       │    ├─ emit('tool:execute_start', …, turnId)
       │    └─ emit('tool:execute_end' | 'tool:failure_classified', …, turnId)
       ├─ emitUser('llm:end', …, turnId)
       └─ reply.send({ turnId, … }) → emit('reply:sent', …, turnId)
```

### 7.2 Collector Turn model

```ts
type Turn = {
  turnId: string
  scope: Scope
  startedAt: number
  endedAt?: number
  status: 'running' | 'ok' | 'error' | 'cancelled'
  incomingMessageIds: string[]
  llmCalls: number
  toolCalls: Array<{ name: string; durationMs: number; ok: boolean; failureReason?: string }>
  reply?: { text: string; target: string; durationMs: number }
  error?: string
}
```

Events update the in-flight `Turn` keyed by `turnId`; on `turn:end` the collector finalises the record, enforces the 512-entry cap, and broadcasts a compact `turn:summary` event so reconnecting clients don't need to replay raw events.

### 7.3 Back-compat with `recentLlm`

`recentLlm` trace buffer is untouched. A `turnId → traceIds[]` lookup is maintained so the dashboard can pivot between the Turn view and the LLM trace view.

## 8. UI layout

### 8.1 Shell

`client/debug/dashboard.html` gains:

- A **context-switcher chip row** under the header, populated from the admin allow-list (DM + each admin-member authorized group, with thread chips under groups that have thread-scoped activity). Includes an `All` chip for cross-context aggregates.
- A **2-column panel grid** replacing today's single-column stack.
- A **log drawer** at the bottom (existing `logs.ts` content) now accepting a `turnId` filter alongside `scope`, `q`, `level`.

```
┌ header · stats · connection ─────────────────────────────────┐
│ Sessions  [admin DM] [wizard 2/7]    Scheduler ✓  Pollers ✓  │
│ Context:  ( DM ) [group eng/994] [group eng/881] [all ▾]     │
├──────────────────────────────┬───────────────────────────────┤
│ Turns                        │ Reminders                     │
├──────────────────────────────┼───────────────────────────────┤
│ Memos                        │ Notifications / Replies       │
├──────────────────────────────┼───────────────────────────────┤
│ Tool failures                │ Identity · File relay · Auth  │
├──────────────────────────────┴───────────────────────────────┤
│ Logs  [q:____] [scope:____] [turn:#… ▾]  (cross-linked)      │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 New panel modules

| Panel         | File                                   | Data source                                                                                           |
| ------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Turns         | `client/debug/panels/turns.ts`         | `state:init.recentTurns` + `turn:*`; click opens `/turns/:id`                                         |
| Reminders     | `client/debug/panels/reminders.ts`     | compact snapshot + `recurring:*` / `deferred:*`; click opens `/recurring` or `/deferred`              |
| Memos         | `client/debug/panels/memos.ts`         | lazy `/memos`; search box; `memo:*` patches in place                                                  |
| Notifications | `client/debug/panels/notifications.ts` | ring-buffer tail + `notify:*` / `reply:sent` / `typing:*`                                             |
| Tool failures | `client/debug/panels/tool-failures.ts` | ring-buffer tail + `tool:failure_classified`                                                          |
| Context       | `client/debug/panels/context.ts`       | mix of compact snapshot + lazy REST for identity / file-relay / group-settings / config-editor / auth |

### 8.3 State store

`DashboardState` in `client/debug/dashboard-types.ts` gains:

```ts
state.turns:            Map<contextId, Turn[]>
state.reminders:        Map<contextId, { recurring: RecurringCompact[]; deferred: DeferredCompact[] }>
state.notifications:    Map<contextId, Notification[]>
state.toolFailures:     Map<contextId, ToolFailure[]>
state.memosByUser:      Map<userId, Memo[]>
state.activeContext:    string   // 'dm' | `group:<id>` | `group:<id>:thread:<id>` | 'all'
state.activeLogFilter:  { turnId?: string; scope?: string; resourceId?: string }
```

### 8.4 Cross-links (story 7)

Every row in Turns / Reminders / Notifications / Tool-failures panels exposes a "🔍 logs" action that sets `state.activeLogFilter` and scrolls the log drawer into view. The `/logs` endpoint gains a `turnId` query parameter; structured log lines emitted inside an orchestrator run carry a `turnId` field (pino child logger) so the match is direct.

### 8.5 Rendering style

Matches current conventions: plain functions returning HTML strings, `escapeHtml` for untrusted content, `tree-view.ts` for JSON drill-downs, no framework. `dashboard.css` is additive — new classes `.panel-grid`, `.context-chips`, per-panel wrappers; existing classes carry over.

## 9. Phasing

One spec, four mergeable PRs.

### Phase 1 — Infra (prerequisite)

- Typed `emitUser` / `emitGroup` / `emitGlobal` helpers with `__scope` and optional `turnId`.
- `AdminVisibility` computation and filter; replace `isAdminEvent`.
- `applyVisibility(entries, getScope)` for snapshots.
- Default-deny for unscoped legacy `emit()` + one-shot warning per type.
- Migrate all existing emit sites to the typed helpers.
- No UI-visible change; dashboard behaves identically.

### Phase 2 — Turns, tool failures, notifications

- `turnId` minting in `src/message-queue/`; `turn:start` / `turn:end` envelopes.
- Propagate `turnId` through orchestrator, tool execution, confirmation, reply.
- New events: `queue:*`, `tool:*`, `reply:sent`, `typing:*`, `notify:*`, `tool:failure_classified`.
- In-collector Turn assembly; three ring buffers; `turn:summary` broadcasts.
- `/turns/:id` REST endpoint.
- Context switcher + new panels: Turns, Tool failures, Notifications.

### Phase 3 — Reminders & memos

- Events + snapshot + REST for `src/recurring.ts`, `src/deferred-prompts/`, `src/memos.ts`.
- Panels: Reminders, Memos.
- `promote_memo` / `search_memos` lifecycle hooks.

### Phase 4 — Context & log cross-links

- Events, snapshots, REST where applicable for identity, file-relay, group-settings, config-editor, authorized-groups, group-members.
- Context panel.
- `turnId` param on `/logs`; orchestrator log lines carry `turnId`; cross-link action in earlier panels; log drawer filter UI.
- Once no caller of bare `emit()` remains after Phase 1 migration, remove the function and its deprecation-warning path from `src/debug/event-bus.ts`.

## 10. Testing

- Unit tests per new emitter source module: assert scope kind and payload shape via a new `captureEvents()` test helper.
- Collector tests: allow-list computation (`authorized` ∩ `member`), invalidation on `auth:*` / `group_member:*`, per-event-type filter routing, leak tests (synthetic events for a non-admin user must not reach any connected SSE client), default-deny for unscoped events.
- Turn-assembly tests: simulated event streams across success / error / cancellation, overlapping turns for different users, stalled turn closed via `finally`.
- Dashboard tests under `tests/client/`: new panels render expected DOM from fixtures; context switcher filters state correctly; log cross-link updates filter state.
- Existing `tests/debug/dashboard-smoke.test.ts` stays green; no E2E additions needed.
- Mutation testing is not extended for this work (additive observability).

## 11. Risks

1. **Event volume.** Additional per-turn events (queue, tool request/confirm/execute, typing, reply) amplify SSE traffic under load. Mitigation: keep the existing 500ms debounced `stats` broadcast; coalesce `typing:*` so only start/stop pairs ship.
2. **`turnId` threading.** Adding a parameter to orchestrator and tool execute changes signatures used across many tests. Mitigation: default `turnId` to a fresh UUID when absent so callers that don't care keep working.
3. **Allow-list staleness.** If chat-platform membership changes outside the bot (admin kicked from a group on Telegram) the `group_members` table lags. Mitigation: allow-list recomputes on every SSE reconnect; acceptable for a debug tool.
4. **Drill-down payload drift.** Memo / recurring / deferred records evolve. Mitigation: Zod schemas mirror source types; REST returns raw records; UI uses `tree-view.ts` for tolerant rendering.

## 12. Out of scope

- Web-fetch cache internals, embeddings call tracking, announcements internals.
- Persistent historical store beyond existing in-memory buffers and SQLite.
- Multi-admin view, redaction, or role-based visibility.
- Chat-provider membership API integration (Telegram `getChatMember` and equivalents).
- Mutation testing, visual regression testing, or E2E coverage beyond the existing smoke.
- Changes to log-buffer size or logger scopes.

## 13. Open questions

None at approval time. Any that arise during planning are deferred to the implementation-plan document.
