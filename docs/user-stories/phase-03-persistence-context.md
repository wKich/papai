# Phase 3: Persistence & Context — User Stories

# User Story 1: Picking Up Where I Left Off

**As a** returning bot user
**I want** the bot to remember our previous conversation when I come back
**So that** I can continue managing my tasks without re-explaining context every time

## Acceptance Criteria

**Given** I had a conversation with the bot earlier (including creating, updating, or discussing tasks)
**When** I send a new message in a later session
**Then** the bot correctly references and applies context from my previous messages without me having to repeat myself

---

# User Story 2: Surviving Restarts Without Losing Memory

**As a** regular bot user
**I want** the bot's memory of our conversations to persist across restarts or outages
**So that** a server restart doesn't wipe out the context of ongoing work

## Acceptance Criteria

**Given** I have an active conversation history with the bot
**When** the bot service is restarted
**Then** the next message I send is handled with full awareness of our past exchanges, as if no interruption occurred

---

# User Story 3: Maintaining Context in Long Conversations

**As a** power user who manages many tasks through the bot
**I want** the bot to stay coherent and accurate even after dozens of messages
**So that** I do not need to scroll back and repeat instructions when working on complex, multi-step tasks

## Acceptance Criteria

**Given** I have sent more than 50 messages in an ongoing conversation session
**When** I ask the bot about something discussed much earlier (e.g., a project name, a priority decision, or a task title)
**Then** the bot provides a consistent and accurate response without losing track of earlier decisions

---

# User Story 4: Remembering Key Facts About My Projects

**As a** bot user who frequently mentions specific projects, people, and priorities
**I want** the bot to remember recurring names and entities I mention over time
**So that** I can refer to them informally without always spelling out full identifiers

## Acceptance Criteria

**Given** I have previously mentioned a project by a short or informal name (e.g. "the mobile app project")
**When** I reference the same project again in a later message
**Then** the bot recognises the reference correctly and performs the intended action without asking me to clarify which project I mean

---

# User Story 5: Getting a Useful Summary of Past Activity

**As a** user returning after a break
**I want** the bot to offer a brief recap of what we discussed or accomplished recently
**So that** I can quickly re-orient and pick up ongoing work without manually reviewing chat history

## Acceptance Criteria

**Given** I have had previous conversations with the bot
**When** I ask something like "what were we working on last time?" or "what did I ask you to do recently?"
**Then** the bot provides a concise, accurate summary of the most recent actions and decisions from our conversation history

---

## Technical Problems Solved

- The bot previously lost all conversation history on restart, requiring users to repeat context on every session
- Multi-turn conversations were broken — the bot could not reference its own previous responses within a single conversation
- There was no persistent storage for conversation state, making the bot stateless across all interactions
- Long conversations degraded in quality because no mechanism existed to manage context window limits gracefully
- Repeated mentions of the same projects, tasks, or people were not retained, forcing users to over-specify every request
- The lack of a versioned schema management mechanism made it impossible to safely evolve the bot's data storage over time
