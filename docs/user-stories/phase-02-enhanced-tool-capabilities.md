# Phase 2: Enhanced Tool Capabilities — User Stories

---

# User Story 1: Leaving Comments on Tasks

**As a** team member
**I want** to add a comment to an existing task by describing it in a message
**So that** I can communicate progress, questions, or decisions directly on the relevant task without switching to another tool

## Acceptance Criteria

**Given** I am chatting with the bot and there is an existing task I can refer to by name or ID
**When** I say something like "add a comment to the login bug: 'waiting for backend fix'"
**Then** the comment appears on the task and the bot confirms it was posted

---

# User Story 2: Setting Due Dates on Tasks

**As a** project manager
**I want** to set or update a due date on a task by mentioning it naturally in a message
**So that** deadlines are recorded in the task tracker without me having to open the tracker manually

## Acceptance Criteria

**Given** I am chatting with the bot and a task exists for the work I want to schedule
**When** I say "set the due date on 'deploy staging' to next Friday"
**Then** the bot updates the task's due date and confirms the new deadline to me

---

# User Story 3: Viewing Full Task Details

**As a** team member
**I want** to ask the bot for the full details of a task — including its description and all comments
**So that** I can get a complete picture of any task without leaving the chat

## Acceptance Criteria

**Given** a task exists with a description and at least one comment
**When** I ask the bot "show me everything about the payment integration task"
**Then** the bot replies with the task's title, description, current status, and all comments in a readable format

---

# User Story 4: Discovering and Applying Labels

**As a** team member
**I want** to list available labels, create new ones, and apply them to tasks through natural language
**So that** I can organise and filter tasks by category, priority, or team without memorising tag names in advance

## Acceptance Criteria

**Given** I am working with tasks that need categorisation
**When** I ask "what labels exist?" the bot lists all labels; when I say "create a label called 'blocked'" the bot creates it; and when I say "add the 'blocked' label to the auth task" the bot applies it
**Then** each action is confirmed and the label state in the tracker reflects the change

---

# User Story 5: Removing Labels from Tasks

**As a** team member
**I want** to remove a label from a task when it no longer applies
**So that** task metadata stays accurate and filtered views remain meaningful

## Acceptance Criteria

**Given** a task has one or more labels applied to it
**When** I say "remove the 'blocked' label from the auth task"
**Then** the bot removes the label from the task and confirms it has been removed

---

# User Story 6: Linking Related Tasks

**As a** team member
**I want** to declare relationships between tasks — such as one blocking another, being a duplicate, or simply being related
**So that** the team can understand dependencies and avoid duplicated work

## Acceptance Criteria

**Given** two tasks exist in the tracker
**When** I say "mark the database migration task as blocking the API refactor task"
**Then** the bot creates the blocking relationship and confirms it; when I ask for details on either task, the relation is shown in the response

---

# User Story 7: Creating a New Project

**As a** project manager
**I want** to create a new project by describing it in a message
**So that** I can organise work into separate projects without opening the task tracker interface

## Acceptance Criteria

**Given** I am chatting with the bot and no project exists yet for a new initiative
**When** I say "create a project called 'Mobile App Redesign'"
**Then** the bot creates the project and confirms its name; subsequent task creation requests can use this project name

---

# User Story 8: Archiving or Deleting Tasks

**As a** project manager
**I want** to archive completed work or permanently delete tasks that are no longer relevant
**So that** the task tracker stays clean and focused without irrelevant entries cluttering views

## Acceptance Criteria

**Given** a task exists that I want to remove from active views
**When** I say "archive the old onboarding task" or "delete the duplicate payment task"
**Then** the bot archives or deletes the task as requested and confirms the action; the task no longer appears in standard list or search results

---

## Technical Problems Solved

- Expanded the set of task operations available through natural language beyond basic create/update/list, covering the full lifecycle of a task (comment, label, relate, archive, delete)
- Enabled label management end-to-end: discovery, creation, application, and removal, so the LLM can handle any label-related request without asking the user to open the tracker
- Introduced task relation tracking (blocks, blocked_by, duplicate, related) so dependency graphs can be built and queried conversationally
- Added due date writes as a discrete update field, ensuring scheduling information is captured in the tracker from chat
- Implemented full task detail retrieval including description and comment threads, giving the LLM enough context to answer questions about any task
- Added project creation as a first-class operation, unblocking multi-project workflows from day one of a new initiative
- Covered destructive operations (archive, delete) with explicit confirmation semantics, protecting against accidental data loss while keeping the interaction natural
