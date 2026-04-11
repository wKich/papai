# Discord ChatProvider — Direction Brief

**Status:** Brainstorming output. Upstream of the full design doc (`docs/discord-chat-design.md`).
**Date:** 2026-04-09
**Author:** designing-new-provider skill, Phase 3 (brainstorming).

This document captures the direction agreed with the user before research starts. It is deliberately short. The full 14-section design doc will replace it once the `context7` research pass has happened.

## Intent

Add a third `ChatProvider` implementation — Discord — alongside Telegram and Mattermost. Users on Discord should be able to DM the bot, or @mention it in any guild channel where it has access, and get the same task-management experience that Telegram and Mattermost users already get.

## Confirmed inputs (from user, locked)

| Placeholder       | Value                                                             |
| ----------------- | ----------------------------------------------------------------- |
| Provider type     | chat (`ChatProvider`)                                             |
| Provider name     | `discord`                                                         |
| Official API docs | https://discord.com/developers/docs                               |
| Auth model        | Bot Token (single Application, not OAuth2 user-install)           |
| Hosting           | SaaS only                                                         |
| SDK               | `discord.js` (full package, not the `@discordjs/core` split)      |
| MVP scope         | DMs + guild channels on @mention                                  |
| Hard non-goals    | Discord slash commands; reactions; threads; voice; stage channels |
| Deadline          | None — quality over speed                                         |

## Chosen direction — "Mattermost-parallel, minimum privilege"

Mirror the structure of `src/chat/mattermost/`. A single `DiscordChatProvider` class wraps a `discord.js` `Client` and maps Discord Gateway events onto papai's `ChatProvider` interface.

### Gateway intents requested

- `Guilds`
- `GuildMessages`
- `DirectMessages`

**No privileged `MessageContent` intent** is requested. Discord delivers full message content unconditionally for (a) DM channels and (b) guild messages that @mention the bot user, which is exactly the MVP scope. This must be re-verified against current Discord docs in the research phase.

### Event → `IncomingMessage` mapping

| Field              | Value                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `user.id`          | `message.author.id` (snowflake, string)                                                                                                     |
| `user.username`    | `message.author.username` (Discord handle post-pomelo migration)                                                                            |
| `user.isAdmin`     | `message.author.id === ADMIN_USER_ID` (global, unchanged)                                                                                   |
| `contextType`      | `'dm'` if channel type is DM, else `'group'`                                                                                                |
| `contextId`        | user snowflake in DMs; channel snowflake in guild channels                                                                                  |
| `isMentioned`      | `message.mentions.has(client.user.id)` — trivially `true` in guild channels because of the no-intent delivery rule; derived normally in DMs |
| `text`             | `message.content` with the leading `<@!?botId>` mention stripped and trimmed                                                                |
| `messageId`        | `message.id` (for `redactMessage`)                                                                                                          |
| `replyToMessageId` | `message.reference?.messageId`                                                                                                              |
| `replyContext`     | populated from `message.reference` + optional REST fetch of parent                                                                          |
| `files`            | always empty in Phase 1                                                                                                                     |
| `commandMatch`     | regex match against the post-mention-strip text                                                                                             |

### Authorization

Unchanged. `ADMIN_USER_ID` + `src/users.ts` allowlist are global. A user authorized in DMs is authorized in every guild channel the bot can see. No per-guild role awareness. No new tables. This matches papai's "personal bot" posture.

### `ReplyFn` implementation

| Method          | Implementation                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`          | `channel.send({ content, reply: opts.replyToMessageId ? {messageReference: ...} : undefined })`                                                                                                |
| `formatted`     | Convert LLM markdown via `src/chat/discord/format.ts` — Discord's dialect is a near-superset, so mostly identity. Escape `@everyone` / `@here`. Chunk >2000 chars into multiple messages.      |
| `file`          | **Phase 1: throws `Error('not implemented')`.** Flagged risk: `/context` admin command will not work on Discord until Phase 2.                                                                 |
| `typing`        | `channel.sendTyping()` (fire-and-forget; Discord auto-expires after 8s)                                                                                                                        |
| `redactMessage` | `channel.messages.edit(botMessageId, { content: replacement, components: [] })`                                                                                                                |
| `buttons`       | Discord `ActionRowBuilder` + `ButtonBuilder`; `primary→Primary`, `secondary→Secondary`, `danger→Danger`; interaction events routed back into the same callbackData path as Telegram/Mattermost |

### Files anticipated (non-prescriptive)

- `src/chat/discord/index.ts` — `DiscordChatProvider`
- `src/chat/discord/format.ts` — markdown normalization + 2000-char chunking
- `src/chat/discord/map-message.ts` — `Message → IncomingMessage`
- `src/chat/discord/buttons.ts` — component builder + interaction dispatch
- `src/chat/registry.ts` — add `discord` case
- `src/index.ts` — add `DISCORD_BOT_TOKEN` to env validation when `CHAT_PROVIDER=discord`
- `tests/chat/discord/*.test.ts` — unit tests with mocked `discord.js` client
- `docs/discord-chat-design.md` — full 14-section design doc (written after research)
- `docs/plans/2026-04-09-discord-implementation.md` — TDD implementation plan

## Explicit non-goals

- Discord application (slash) commands. Text-prefix commands only, post-mention-strip.
- Message reactions, threads, voice, and stage channels.
- `MessageContent` privileged intent.
- OAuth2 user install; multi-tenant Application support.
- Incoming file uploads (`IncomingMessage.files` stays empty in Phase 1).
- Per-guild authorization or role-aware admin detection.
- Sharding (papai is a personal bot, single shard is always sufficient for <2500 guilds).

## Open questions for the research phase

These must be confirmed via `context7` (Discord docs) before the full design doc is written:

1. **Content exemption matrix.** Verify current Discord docs that DMs and @mention messages deliver full `content` / `embeds` / `attachments` without the `MessageContent` intent. If the exemption has been narrowed since the 2022 announcement, fall back to requesting the privileged intent and call it out.
2. **Message length cap.** Re-confirm 2000-char cap for regular bot messages (not 4000, which requires Nitro / webhook).
3. **Rate limits.** Per-channel send rate limit values and the 429 retry-after header convention used by `discord.js`' rate-limit manager.
4. **Gateway reconnect / resume semantics.** Confirm `discord.js` Client auto-resumes on zombied connections without additional wiring.
5. **Ed25519 / HTTP interactions.** Confirm we do NOT need to stand up an HTTPS interaction endpoint (we're purely Gateway-based, so no).
6. **`redactMessage` eligibility.** Bots can only edit their own messages; confirm that any redaction target passed to `redactMessage` will always be a bot-authored message (it is — the helper is only called on bot output).
7. **Username handling post-pomelo.** Discord migrated from `username#discriminator` to unique handles. Confirm `message.author.username` is the display handle and does not need discriminator concatenation.
8. **`resolveUserId(username)`.** There is no public username→ID lookup via the REST API for users outside guilds the bot shares. Research the constrained form (`guild.members.fetch({ query })`) and document the limitations. This may need to be a no-op that returns `null` with a `log.warn`.
9. **`getPromptAddendum()` equivalent.** `ChatProvider` has no `getPromptAddendum()` (that's on `TaskProvider`). Confirm no LLM-side prompt injection is needed for Discord.
10. **Buttons custom-id length.** Discord limits `custom_id` to 100 characters; confirm papai's `callbackData` strings fit, and design a truncation/hash strategy if not.

## Non-negotiables baked into the plan

- Bun runtime; Zod v4 for any request/response shapes; oxlint/oxfmt; pino logging (`log.debug` on entry, `log.info` on success, `log.error` on caught exceptions with `error instanceof Error ? error.message : String(error)`).
- `.js` extension in every relative import.
- No `lint-disable`, `@ts-ignore`, `@ts-nocheck` — fix the underlying issue.
- TDD red → green → commit for every task; test file first, must fail, then impl. The hook pipeline will block any deviation.
- Never log tokens, bot tokens, interaction IDs tied to user identity, or PII.

## Next step

Return to the `designing-new-provider` skill and execute Step 4 — research:

1. Read the remaining `CLAUDE.md` files (`src/tools/CLAUDE.md`, `tests/CLAUDE.md`) and both reference implementations (`src/chat/telegram/`, `src/chat/mattermost/`) in full.
2. Fetch Discord Gateway + REST + Components docs via `context7`.
3. Resolve the 10 open questions above.
4. Write `docs/discord-chat-design.md` with all 14 sections from the brief template.
5. Write `docs/plans/2026-04-09-discord-implementation.md` via the `writing-plans` sub-skill.
6. Hand off to a fresh executor session.
