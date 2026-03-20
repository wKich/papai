# Phase 8: Recurring Work Automation — User Stories

---

# User Story 1: Set Up a Task That Repeats on a Fixed Schedule

**As a** team lead  
**I want** to tell the bot to create a task automatically every week (or on another regular interval)  
**So that** routine work appears in my project without me having to remember to create it each time

## Acceptance Criteria

**Given** I have an active project in my task tracker  
**When** I tell the bot "create a weekly recurring task called 'Team sync notes' in the Operations project, every Monday"  
**Then** the bot confirms the recurring task has been set up, and a new task titled "Team sync notes" is created in the Operations project each Monday going forward

---

# User Story 2: Set Up a Task That Recurs After Completion

**As a** project manager  
**I want** to configure a task so that the next occurrence is only created once the current one is marked done  
**So that** the team is never overwhelmed with duplicate open tasks and each cycle only starts when the previous one finishes

## Acceptance Criteria

**Given** an existing recurring task configured to create the next occurrence after completion  
**When** the current open task is marked as done  
**Then** the bot automatically creates a new task with the same title, project, and settings, and notifies me that the next occurrence is now open

---

# User Story 3: Recurring Tasks Carry Over Labels, Priority, and Assignee

**As a** team lead  
**I want** each new occurrence of a recurring task to automatically inherit the labels, priority, and assignee from the original definition  
**So that** I do not need to manually re-apply metadata to every generated task

## Acceptance Criteria

**Given** a recurring task defined with the label "weekly-ops", priority "high", and assignee "alice"  
**When** a new occurrence of that task is created  
**Then** the generated task has the label "weekly-ops", priority "high", and is assigned to "alice" without any manual intervention

---

# User Story 4: Skip or Pause a Recurring Task Series

**As a** user  
**I want** to skip the next occurrence of a recurring task, or pause the entire series temporarily, without deleting it  
**So that** I can accommodate holidays, sprints, or exceptional circumstances without losing the recurring setup for future cycles

## Acceptance Criteria

**Given** an active recurring task series  
**When** I tell the bot "skip the next occurrence of 'Team sync notes'" or "pause the 'Team sync notes' series"  
**Then** the bot confirms the action; for a skip, the upcoming occurrence is not created and the series resumes normally after that; for a pause, no further occurrences are created until I explicitly resume the series

---

# User Story 5: Control Whether Missed Occurrences Are Created Retroactively

**As a** project manager  
**I want** to choose whether tasks missed during a pause or downtime are created retroactively or simply ignored  
**So that** I can decide whether the team needs to catch up on skipped work or move forward from today

## Acceptance Criteria

**Given** a recurring task series that was paused and then resumed after several scheduled occurrences were missed  
**When** I resume the series and specify "create missed tasks" or "ignore missed occurrences"  
**Then** the bot either creates one task for each missed cycle with their original due dates, or skips all missed cycles and creates only the next upcoming occurrence, according to my instruction

---

# User Story 6: List and Review All Recurring Task Definitions

**As a** team lead  
**I want** to ask the bot to show me all recurring tasks I have configured  
**So that** I can review what is scheduled, confirm the settings are still correct, and identify any series I want to modify or stop

## Acceptance Criteria

**Given** I have one or more recurring tasks configured  
**When** I ask the bot "show me all my recurring tasks"  
**Then** the bot replies with a list of each recurring task, including its name, project, schedule or trigger, current status (active or paused), and the date of the next expected occurrence

---

# User Story 7: Stop a Recurring Task Series Permanently

**As a** user  
**I want** to permanently cancel a recurring task series when that type of work is no longer needed  
**So that** no further occurrences are created and the series no longer appears in my recurring task list

## Acceptance Criteria

**Given** an active recurring task series named "Weekly dependency audit"  
**When** I tell the bot "stop the 'Weekly dependency audit' recurring task"  
**Then** the bot confirms the series has been cancelled, no further occurrences are created, and the series no longer appears when I list my recurring tasks

---

## Technical Problems Solved

- Routine tasks being forgotten or created inconsistently because they depend on manual effort each cycle
- No way to express completion-triggered work patterns, causing teams to poll for closure before starting the next cycle
- Metadata such as labels, assignees, and priorities having to be re-applied manually to every generated task
- No mechanism to temporarily suspend a recurring series without deleting it, forcing destructive workarounds
- Missed-occurrence behaviour being undefined, leaving teams uncertain whether to catch up on skipped work
- No single view of all scheduled recurring work, making it hard to audit or modify standing commitments
- Cancelling recurring work requiring deletion of the original task rather than a dedicated stop command
