# User Story 1: Morning Briefing at a Chosen Time

**As a** project manager starting my work day
**I want** the bot to automatically send me a summary of my tasks at a time I choose each morning
**So that** I always begin the day informed about what needs attention without having to ask for it

## Acceptance Criteria

**Given** I have configured a morning briefing time and my local timezone
**When** that time arrives on a working day
**Then** the bot sends me a briefing that includes tasks due today, overdue tasks, tasks I have in progress, and three suggested priority actions for the day

---

# User Story 2: Choosing Between a Short and a Full Briefing

**As a** busy user who values brevity in the morning
**I want** to choose whether my daily briefing shows a compact summary or the full breakdown of all sections
**So that** the briefing fits my preferred level of detail without me having to wade through information I do not need

## Acceptance Criteria

**Given** I have set my briefing mode to "short"
**When** the scheduled briefing is sent
**Then** I receive only the high-level summary counts (e.g., 3 due today, 2 overdue) with no section-by-section detail

**Given** I have set my briefing mode to "full"
**When** the scheduled briefing is sent
**Then** I receive each section in full — due today, overdue, in-progress, recently updated, newly assigned, and suggested actions

---

# User Story 3: Missed Briefing Catch-Up on First Message

**As a** user who sometimes starts the day late or away from the app
**I want** to still receive my daily briefing the first time I message the bot, if the scheduled delivery was missed
**So that** I never lose visibility into my task state even when I open the app later than usual

## Acceptance Criteria

**Given** the scheduled morning briefing time has already passed for today and the briefing was not delivered
**When** I send the bot my first message of the day
**Then** the bot prepends a catch-up briefing to its response before addressing my message, noting it is a catch-up for the briefing I missed

---

# User Story 4: Pre-Deadline Nudge for Approaching Due Dates

**As a** team member managing several open tasks
**I want** to receive an automatic reminder the day before a task is due
**So that** I have time to act on it or escalate before the deadline passes

## Acceptance Criteria

**Given** deadline nudges are enabled and I have a task due tomorrow that is still open
**When** the day before the due date begins
**Then** the bot sends me a message naming the task, its due date, and its current status, prompting me to act

---

# User Story 5: Due-Day and Overdue Escalation Alerts

**As a** user responsible for on-time delivery
**I want** to receive an urgent alert on the day a task is due and a follow-up alert the next day if it is still not done
**So that** missed deadlines are surfaced immediately and I am not left unaware of overdue work

## Acceptance Criteria

**Given** a task is due today and its status is still open
**When** the due date arrives
**Then** the bot sends me an urgent alert identifying the task by name and due date, asking me to update or complete it

**Given** a task was due yesterday and is still not marked complete
**When** the day after the due date begins
**Then** the bot sends a follow-up alert indicating the task is now overdue and prompting me to resolve or escalate it

**Given** a task remains incomplete multiple days past its due date
**When** each day passes without a status change
**Then** the bot escalates the tone of its alerts progressively — from a soft reminder to an urgent daily notice — until the task is resolved

---

# User Story 6: Staleness Alert for Inactive Tasks

**As a** team lead monitoring project health
**I want** to be alerted when a task has had no progress for a configurable number of days
**So that** work that has gone silent is surfaced before it becomes a bottleneck

## Acceptance Criteria

**Given** I have configured a staleness threshold in days
**When** a task reaches that many days with no status change or update
**Then** the bot sends me a message identifying the task by name, its current status, and how many days it has been inactive

---

# User Story 7: Alert for Tasks Blocked Near Their Deadline

**As a** project manager tracking dependency chains
**I want** to be alerted when a task is approaching its deadline but is still blocked by an unresolved dependency
**So that** I can intervene on the blocker before the deadline is missed

## Acceptance Criteria

**Given** deadline nudges are enabled and a task has an unresolved blocker
**When** that task's due date is one or fewer days away
**Then** the bot sends me a message naming both the blocked task and its unresolved blocker, and notes that the deadline is imminent

---

# User Story 8: One-Time Reminders in Natural Language

**As a** user who wants lightweight personal reminders
**I want** to tell the bot to remind me about something in natural language — like "remind me tomorrow at 9" or "in 3 hours"
**So that** I can set reminders quickly without leaving the chat or using a separate app

## Acceptance Criteria

**Given** I send the bot a message like "remind me to follow up with Alice tomorrow at 9am"
**When** that time arrives
**Then** the bot sends me a message with the exact text I asked it to remember, delivered at the time I specified

**Given** I set a reminder tied to a specific task ("remind me about TASK-42 one day before its deadline")
**When** the day before that task's due date arrives
**Then** the bot sends me a reminder naming the task and its upcoming deadline

---

# User Story 9: Repeating Reminders on a Fixed Schedule

**As a** user with recurring responsibilities
**I want** to set a repeating reminder — such as "every Friday at 4pm" or "every weekday morning"
**So that** I receive consistent prompts for routine tasks without re-creating the reminder each week

## Acceptance Criteria

**Given** I have set a repeating reminder for every Friday at 4pm
**When** each Friday at 4pm arrives
**Then** the bot sends me the reminder message I specified, and the recurrence continues on subsequent Fridays until I explicitly cancel it

---

# User Story 10: Snooze, Reschedule, and Act from a Reminder

**As a** user who receives a reminder at an inconvenient time
**I want** to snooze it for a short while, reschedule it to a different time, or mark the related task as done directly from the reminder message
**So that** I can manage follow-up without switching context or navigating back to find the original task

## Acceptance Criteria

**Given** the bot sends me a reminder about a task
**When** I respond with "snooze 1 hour"
**Then** the bot confirms the snooze and resends the same reminder one hour later

**Given** the bot sends me a reminder about a task
**When** I respond with "reschedule to tomorrow morning"
**Then** the bot confirms the new time and cancels the current reminder

**Given** the bot sends me a reminder about an open task
**When** I respond with "done" or ask the bot to mark it complete
**Then** the bot marks the task as completed in the tracker and confirms the action without requiring a separate command

**Given** the bot has already sent me a reminder about the same task recently
**When** the next automatic nudge for that task would be triggered
**Then** the bot skips sending a duplicate message until the suppression window has passed

---

## Technical Problems Solved

- The bot had no way to initiate contact — it could only respond, leaving time-sensitive information unseen until the user explicitly asked
- Users had no single daily entry point summarising their task load, requiring manual queries every morning
- Deadlines could pass silently with no notification if the user did not check in at the right moment
- Stale tasks with no recent activity were invisible unless the user actively searched for them
- Blocked tasks approaching their deadline had no escalation path, requiring users to monitor blockers manually
- There was no mechanism to schedule future messages or reminders from within the chat interface
- Recurring responsibilities required the user to re-issue reminder requests manually each cycle
- Duplicate nudges for the same issue could not be suppressed, risking alert fatigue
- Users could not act on a reminder (snooze, reschedule, complete the task) from within the reminder message itself
- Timezone-awareness was absent, making any time-based scheduling unreliable for users outside UTC
