# Bot Configuration UX Design

**Date:** 2026-03-27
**Status:** Approved
**Author:** Claude Code

## Problem Statement

The current `/set <key> <value>` command syntax is confusing for non-technical users. Users need to:

- Memorize config key names
- Understand the format for each value
- Know which keys are required vs optional
- Type commands correctly without guidance

## Goals

1. Eliminate the need to memorize config keys
2. Provide step-by-step guidance for new users
3. Validate configuration in real-time
4. Offer platform-native UIs for configuration management
5. Maintain backward compatibility for power users

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Architecture                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Message  ──→  Wizard State Machine  ──→  Platform Adapter │
│       │                     │                        │       │
│       │                     ▼                        ▼       │
│       │              ┌──────────────┐         ┌──────────┐   │
│       │              │ State Store  │         │ Telegram │   │
│       │              │ (SQLite)     │         │   OR     │   │
│       │              └──────────────┘         │ Mattermost│   │
│       │                     │                 └──────────┘   │
│       │                     │                        │       │
│       └─────────────────────┴────────────────────────┘       │
│                              Response                         │
└─────────────────────────────────────────────────────────────────┘
```

### New Components

- `src/wizard/` - Core wizard engine (platform-agnostic)
- `src/wizard/steps.ts` - Step definitions and validation
- `src/wizard/state.ts` - Wizard state management
- `src/wizard/validation.ts` - Live validation logic
- `src/chat/telegram/wizard-ui.ts` - Telegram-specific UI
- `src/chat/mattermost/wizard-ui.ts` - Mattermost-specific UI
- `src/commands/setup.ts` - New `/setup` command

### Modified Components

- `src/bot.ts` - Add wizard detection in message handler
- `src/commands/set.ts` - Open configuration menu instead of raw command
- `src/commands/config.ts` - Add interactive "Edit" functionality

## Onboarding Wizard Flow

### Step-by-Step Configuration

```
┌────────────────────────────────────────────────────────────────┐
│                    ONBOARDING WIZARD FLOW                      │
└────────────────────────────────────────────────────────────────┘

  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
  │   Start  │────▶│ Step 1:  │────▶│ Step 2:  │────▶│ Step 3:  │
  │          │     │ LLM API  │     │ LLM Base │     │ Main     │
  │ Welcome  │     │   Key    │     │   URL    │     │  Model   │
  └──────────┘     └──────────┘     └──────────┘     └──────────┘
       │                                                │
       │                                          ┌────┴────┐
       │                                          ▼         │
       │                                     ┌──────────┐   │
       │                                     │ Step 4:  │   │
       │                                     │  Small   │   │
       │                                     │  Model   │   │
       │                                     └────┬─────┘   │
       │                                          │         │
       │                                          ▼         │
       │                                     ┌──────────┐   │
       │                                     │ Optional │   │
       │                                     │Embedding │◄──┘
       │                                     │  Model   │
       │                                     └────┬─────┘
       │                                          │
       │     ┌──────────┐     ┌──────────┐       │
       └────▶│ Step N:  │────▶│ Step N+1:│◄───────┘
             │Provider  │     │ Timezone │
             │  Token   │     │          │
             └──────────┘     └────┬─────┘
                                   │
                              ┌────┴────┐
                              ▼         │
                         ┌──────────┐   │
                         │ Summary  │   │
                         │  & Save  │   │
                         └────┬─────┘   │
                              │         │
                              ▼         │
                         ┌──────────┐   │
                         │ Success  │◄──┘
                         │ Message  │
                         └──────────┘
```

### Detailed Step Specifications

| Step    | Field             | Prompt                                  | Validation             | Live Check                      | Error Recovery        |
| ------- | ----------------- | --------------------------------------- | ---------------------- | ------------------------------- | --------------------- |
| 1       | `llm_apikey`      | "🔑 Enter your LLM API key:"            | Non-empty string       | Test API call to `/models`      | Retry, Skip, Help     |
| 2       | `llm_baseurl`     | "🌐 Enter base URL (or 'default'):"     | Valid URL or "default" | HTTP GET to base URL            | Retry, Skip, Help     |
| 3       | `main_model`      | "🤖 Enter main model name:"             | Non-empty              | Check model exists in `/models` | Retry, Skip, Help     |
| 4       | `small_model`     | "⚡ Enter small model (or 'same'):"     | Non-empty or "same"    | Validate or copy main model     | Retry, Skip, Help     |
| 5       | `embedding_model` | "📊 Enter embedding model (or 'skip'):" | Non-empty or "skip"    | Validate or skip                | Retry, Skip, Help     |
| 6       | Provider token    | "🔐 Enter {provider} token:"            | Non-empty              | Test API call to provider       | Retry, Skip, Help     |
| 7       | `timezone`        | "🌍 Enter timezone:"                    | Valid IANA timezone    | Check against IANA DB           | Retry, Skip, Help     |
| Summary | —                 | Shows masked values                     | —                      | All steps validated             | Confirm, Edit, Cancel |

### Live Validation Flow

```
┌────────────────────────────────────────────────────────────────┐
│                    LIVE VALIDATION FLOW                        │
└────────────────────────────────────────────────────────────────┘

User Input ──→ Basic Validation ──→ Live API Check ──→ Success?
                      │                    │              │
                      ▼                    ▼              │
                Invalid Format        Connection          │
                "Please enter        Error              Yes
                 a valid..."        "Cannot connect      │
                                       to..."            │
                                                        │
                                                        ▼
                                              ┌──────────────────┐
                                              │ Success Message  │
                                              │ "✅ Verified!"   │
                                              └────────┬─────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────┐
                                              │  Advance Step    │
                                              └──────────────────┘
```

### Recovery Actions

- **Retry** - Re-prompt for the same value
- **Skip** - Mark as "to be configured later", show warning at summary
- **Help** - Send detailed instructions on how to obtain the value

## Platform-Native Configuration UI

### Telegram: Inline Keyboard Menu

**Main Configuration Menu:**

```
┌─────────────────────────────────────────┐
│           ⚙️ Configuration              │
│                                         │
│  Select a category to configure:        │
│                                         │
│  ┌─────────────┐  ┌─────────────┐      │
│  │  🤖 LLM      │  │ 📋 Provider │      │
│  │  Settings   │  │   Settings  │      │
│  └─────────────┘  └─────────────┘      │
│                                         │
│  ┌─────────────┐  ┌─────────────┐      │
│  │ 🌍 General   │  │ 🔄 Run Setup │     │
│  │  Settings   │  │   Wizard    │      │
│  └─────────────┘  └─────────────┘      │
│                                         │
└─────────────────────────────────────────┘
```

**LLM Settings Sub-menu:**

```
┌─────────────────────────────────────────┐
│           🤖 LLM Settings               │
│                                         │
│  Current values:                        │
│  • API Key: ****sk-abc                  │
│  • Base URL: https://...                │
│  • Main Model: gpt-4                    │
│  • Small Model: gpt-3.5                 │
│                                         │
│  What would you like to change?         │
│                                         │
│  [📝 API Key]  [🌐 Base URL]            │
│  [🤖 Models]   [🔙 Back]               │
└─────────────────────────────────────────┘
```

**Single Setting Edit (inline):**

```
Bot: "Current API Key: ****sk-abc"
     "Enter your new API key or 'cancel':"

User: "sk-newkey123"

Bot: "✅ API key updated successfully!"
     [🔙 Back to LLM Settings]
```

### Mattermost: Interactive Dialogs

**Main Configuration Dialog:**

```json
{
  "trigger_id": "...",
  "dialog": {
    "title": "⚙️ Configuration",
    "icon_url": "...",
    "callback_id": "papai_config_dialog",
    "elements": [
      {
        "type": "select",
        "label": "Select setting to configure",
        "options": [
          { "text": "🤖 LLM Settings", "value": "llm" },
          { "text": "📋 Provider Settings", "value": "provider" },
          { "text": "🌍 General Settings", "value": "general" }
        ]
      }
    ],
    "submit_label": "Configure"
  }
}
```

**LLM Settings Dialog:**

```json
{
  "dialog": {
    "title": "🤖 LLM Configuration",
    "elements": [
      { "type": "text", "label": "API Key", "placeholder": "sk-..." },
      { "type": "text", "label": "Base URL", "placeholder": "https://..." },
      { "type": "text", "label": "Main Model", "placeholder": "gpt-4" },
      { "type": "text", "label": "Small Model", "placeholder": "gpt-3.5" }
    ],
    "submit_label": "Save",
    "notify_on_cancel": true
  }
}
```

## State Management

### Wizard Session Schema

```typescript
interface WizardSession {
  userId: string
  contextId: string
  startedAt: number
  currentStep: number
  totalSteps: number
  data: {
    llm_apikey?: string
    llm_baseurl?: string
    main_model?: string
    small_model?: string
    embedding_model?: string
    provider_token?: string
    timezone?: string
  }
  skippedSteps: number[]
  platform: 'telegram' | 'mattermost'
}
```

### Storage

- **Active sessions**: In-memory Map (userId → WizardSession)
- **Resume capability**: Persist incomplete sessions to SQLite with TTL (24 hours)
- **Cleanup**: Auto-expire sessions after 24 hours or on completion

## Command Changes

| Command              | Old Behavior         | New Behavior                 |
| -------------------- | -------------------- | ---------------------------- |
| `/set <key> <value>` | Direct config update | Opens configuration menu     |
| `/config`            | List current values  | Shows values + "Edit" button |
| `/setup`             | —                    | Launches onboarding wizard   |
| `/help`              | Static help text     | Includes wizard reference    |

## Security Considerations

1. **Sensitive data masking** - API keys and tokens always shown as `****last4`
2. **Session isolation** - Wizard sessions scoped to user+context
3. **No storage of raw inputs** - Values go directly to config store
4. **Redaction** - Telegram messages with sensitive data auto-redacted (existing behavior)

## Error Handling

| Scenario                  | Response                                          |
| ------------------------- | ------------------------------------------------- |
| User exits mid-wizard     | "Your progress is saved. Type /setup to continue" |
| API validation fails      | Specific error + Retry/Skip/Help options          |
| Timeout during validation | "Still checking..." with cancel option            |
| Platform API unavailable  | "Please try again later"                          |
| Invalid wizard state      | Reset and restart from beginning                  |

## Testing Strategy

1. **Unit tests** - Each validation function
2. **Integration tests** - Full wizard flow with mocked APIs
3. **Platform-specific tests** - Telegram inline keyboards, Mattermost dialogs
4. **Edge cases** - Network failures, timeouts, invalid inputs

## Success Metrics

- **Setup completion rate** - % of users who complete the wizard
- **Error rate** - % of validation failures
- **Time to configure** - Average time to complete setup
- **Support requests** - Reduction in "how do I configure" questions

## Implementation Notes

1. **Telegram menus** - Use grammY Menu plugin for inline keyboards
2. **Mattermost dialogs** - Use interactive dialog API with callback handling
3. **Validation caching** - Cache `/models` responses for 5 minutes to avoid rate limits
4. **Provider detection** - Read `TASK_PROVIDER` env var to know which token to request
5. **Backward compatibility** - Keep `/set` working via direct command for automation/scripts

## Future Enhancements

1. **Multi-language support** - Localized prompts based on user preference
2. **Template configs** - "Use OpenAI defaults" one-click option
3. **Import from env** - Pre-fill from environment variables if available
4. **Quick config** - `/setup quick` for minimal required fields only
5. **Config backup/restore** - Export/import configuration as JSON

---

**Approved by:** User
**Next Step:** Invoke `writing-plans` skill to create implementation plan
