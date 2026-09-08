# reply-chunking Specification

## Purpose

Ensures replies longer than a chat platform's message-length limit are delivered in full — as ordered, limit-respecting chunks split on safe boundaries — instead of failing delivery entirely and leaving the user with nothing.

## Requirements

### Requirement: Over-limit replies are split into platform-safe chunks

When a reply exceeds the message-length limit declared by the delivering platform adapter, the delivery path SHALL split it into chunks each at most that limit, choosing split points in order of preference: paragraph boundary first, then line boundary, then a hard cut when no boundary fits within the limit. Splitting SHALL NOT alter or drop reply content other than whitespace consumed at the chosen boundary. A reply within the limit SHALL be delivered as a single, unsplit message. These split-point and content-preservation rules govern the adapters that gain chunking through this change: Telegram, Kontur Talk, and Mattermost. The declared limits today are 4096 for Telegram, 4096 for Kontur Talk, and 16383 for Mattermost; Discord already chunks adapter-locally at 2000 and its behavior is unchanged — its existing splitter is explicitly exempt from this requirement's split-point order and no-alteration rule (it balances code fences across chunks and may prefer sentence or word breaks), and nothing here SHALL be read as mandating a rewrite of it.

#### Scenario: Paragraph-boundary split

- **WHEN** a multi-paragraph reply longer than the adapter's declared limit is delivered
- **THEN** every chunk is within the limit and each split falls on a paragraph or line boundary where one exists within the limit

#### Scenario: Hard cut on unbroken content

- **WHEN** a reply contains no paragraph or line boundary inside any limit-sized window, such as one long unbroken code block
- **THEN** the reply is hard-cut at the limit and no content beyond boundary whitespace is lost

#### Scenario: Content preservation

- **WHEN** a long reply is split and delivered on Telegram, Kontur Talk, or Mattermost
- **THEN** the concatenation of the received chunks reproduces what an unsplit delivery of the same reply would have delivered — the platform's delivered form of the reply (on entity-based Telegram, the formatted delivery rather than the source markdown) — except for whitespace at split boundaries, and except that formatting markers left unbalanced by a split landing inside an inline span or code fence may render literally in the adjacent chunks (span and fence balancing is out of scope for these adapters, mirroring the Discord exemption above)

#### Scenario: Within-limit reply is not split

- **WHEN** a reply's delivered form — on entity-based Telegram, the formatted delivery rather than the source markdown — is shorter than the adapter's declared limit
- **THEN** it is delivered as one message, unchanged

### Requirement: Chunks are delivered in order

Chunks of a split reply SHALL be sent as separate messages in content order, so the recipient reads them in sequence.

#### Scenario: Ordered delivery

- **WHEN** a reply is split into multiple chunks
- **THEN** the recipient receives one message per chunk whose contents, read in arrival order, form the original reply

### Requirement: Chunk send failure is surfaced and never silently drops the remainder

When sending one chunk fails, the delivery path SHALL surface that failure — logging it with enough context to identify the turn and the failed chunk's position, and reflecting it in the turn's delivery outcome — and SHALL still attempt delivery of the remaining chunks. A partial chunk failure SHALL NOT be reported as a fully successful delivery, and the remaining chunks SHALL NOT be silently discarded. These clauses govern the chunk-delivery paths on the adapters that gain chunking through this change — Telegram, Kontur Talk, and Mattermost, immediate and deferred sends alike; Discord's existing chunk delivery keeps its current behavior (unchanged per the splitting requirement above) and is not required to adopt the continue-on-failure or per-chunk logging semantics.

#### Scenario: Middle chunk fails

- **WHEN** the second of four chunks fails to send
- **THEN** the third and fourth chunks are still attempted, and the second chunk's failure is logged and visible in diagnostics

#### Scenario: All chunks succeed

- **WHEN** every chunk of a split reply sends successfully
- **THEN** no delivery failure is surfaced and the turn's delivery outcome is success

### Requirement: Chunking applies to every reply-delivery surface on every platform instance

Chunked delivery SHALL apply to every surface that sends a completed reply on the adapters that lack it — immediate replies and deferred or background sends alike — on every platform instance, regardless of storage or config context and regardless of the recipient's member, admin, or guest status.

#### Scenario: Deferred send on Mattermost

- **WHEN** an over-limit reply is delivered through a deferred or background send on Mattermost
- **THEN** it is chunked to Mattermost's declared limit under the same rules as an immediate reply

#### Scenario: The same long reply across all platforms

- **WHEN** the same over-limit reply is delivered on Telegram, Kontur Talk, Mattermost, and Discord
- **THEN** the user receives the full text on every platform, with every chunk within that platform's declared message-length limit
