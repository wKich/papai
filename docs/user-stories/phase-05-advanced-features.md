# User Story 1: Granting a Team Member Access to the Bot

**As an** admin managing who can use the bot
**I want** to add a specific person to the list of authorized users
**So that** a new team member can start using the bot to manage tasks without me changing any server configuration

## Acceptance Criteria

**Given** I am the admin of the bot and a colleague has asked to be added
**When** I send the bot the command to add that colleague by their Telegram username
**Then** the bot confirms the user has been added and that person can immediately send messages to the bot and receive responses

---

# User Story 2: Revoking Access for a Departed Team Member

**As an** admin managing who can use the bot
**I want** to remove a specific person's access to the bot
**So that** former team members or people who should no longer use the bot are blocked without affecting anyone else

## Acceptance Criteria

**Given** a user was previously authorized but should no longer have access
**When** I send the bot the command to remove that person by their username
**Then** the bot confirms the removal and any subsequent message from that person is silently ignored or met with an access-denied notice

---

# User Story 3: First-Time Use as a Newly Authorized Team Member

**As a** newly authorized team member
**I want** to send the bot a natural language request right after being added
**So that** I can start managing my tasks immediately without any setup, onboarding steps, or waiting for a restart

## Acceptance Criteria

**Given** the admin has just added me to the authorized users list
**When** I send the bot my first message asking it to list my tasks or create a new one
**Then** the bot responds to my request as it would for any other authorized user, using my own isolated context and configuration

---

# User Story 4: Choosing a Different AI Model for My Account

**As a** user who wants to experiment with a different AI model
**I want** to point the bot at a different AI provider and model of my choice
**So that** I can use a model that better suits my workload or budget without anyone touching the server

## Acceptance Criteria

**Given** I am an authorized user and I have credentials for an AI provider of my choice
**When** I send the bot the configuration commands to set my preferred provider, model, and credentials
**Then** all subsequent requests I send are processed by the model I specified, and changes to my settings do not affect any other user's model choice

---

# User Story 5: Keeping Per-User Configurations Isolated

**As a** user who has configured a custom AI model and task tracker credentials
**I want** my personal settings to remain mine alone
**So that** changes made by other users or the admin do not overwrite my configuration or expose my credentials

## Acceptance Criteria

**Given** two different authorized users have each configured different AI models and task tracker credentials
**When** one user updates their own model setting
**Then** the other user's model setting is unchanged and their next request continues to use their own configuration

---

# User Story 6: Being Turned Away When Not Authorized

**As a** Telegram user who has not been granted access
**I want** the bot to clearly decline my messages rather than silently ignoring them
**So that** I understand I do not have permission and can request access from the admin if needed

## Acceptance Criteria

**Given** I have sent a message to the bot and I am not on the authorized users list
**When** the bot receives my message
**Then** the bot does not act on my request, does not reveal any task data, and either ignores the message or replies with a brief notice indicating I am not authorized to use the bot

---

## Technical Problems Solved

- Single hardcoded user preventing team adoption of the bot
- No mechanism for an admin to grant or revoke access at runtime without restarting or reconfiguring the server
- All users sharing one global conversation history and configuration, making multi-user operation impossible
- The AI model being fixed at deployment time, requiring a code change or redeployment to switch providers or models
- No isolation between users' credentials, task tracker settings, and conversation contexts
