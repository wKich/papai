# Bot Configuration UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build interactive onboarding wizard and platform-native configuration UI to simplify bot setup for non-technical users.

**Architecture:** Create a platform-agnostic wizard engine with state management, live validation, and platform-specific UI adapters (Telegram inline keyboards, Mattermost dialogs). The wizard guides users through configuration steps with real-time validation.

**Tech Stack:** TypeScript, Grammy (Telegram), Mattermost API, SQLite (state), Zod (validation), Vercel AI SDK (live checks)

---

## Pre-Implementation Checklist

- [ ] Read existing config system in `src/config.ts` and `src/types/config.ts`
- [ ] Read chat provider interfaces in `src/chat/types.ts`
- [ ] Read Telegram provider in `src/chat/telegram/index.ts`
- [ ] Read Mattermost provider in `src/chat/mattermost/index.ts` (if exists)
- [ ] Understand existing `/set` and `/config` command implementations

---

## Architecture Design

**CRITICAL - Platform-Agnostic Design:**

The wizard must maintain the existing architecture where `bot.ts` is the platform-agnostic orchestration layer:

```
┌────────────────────────────────────────────────────────────────┐
│                    ARCHITECTURE FLOW                           │
└────────────────────────────────────────────────────────────────┘

  User Message
       │
       ▼
  ┌─────────┐   Platform extraction   ┌──────────┐
  │Telegram │ ──────────────────────→ │ bot.ts   │
  │Provider │                         │ message  │
  └─────────┘                         │ handler  │
                                      └────┬─────┘
                                           │
              ┌────────────────────────────┼────────────────────┐
              │                            │                    │
              ▼                            ▼                    ▼
         ┌──────────┐               ┌──────────┐         ┌──────────┐
         │ Check    │──Yes──→       │ Process  │         │ Normal   │
         │ wizard   │   handle      │ command  │         │ message  │
         │ active?  │   wizard      │          │         │ flow     │
         └──────────┘               └──────────┘         └──────────┘
              │ No
              │
              └────────────────────────────────────────────────────┘

Key Points:
- Wizard check happens in bot.ts (platform-agnostic)
- ChatProvider interface unchanged
- Platform-specific callbacks registered in provider.start()
```

---

## Phase 1: Core Wizard Engine

### Task 1: Create Wizard State Types

**Files:**

- Create: `src/wizard/types.ts`
- Test: `tests/wizard/types.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, test } from 'bun:test'
import type { WizardSession } from '../../src/wizard/types.js'

describe('WizardSession type', () => {
  test('should accept valid session', () => {
    const session: WizardSession = {
      userId: '123',
      contextId: '123',
      startedAt: Date.now(),
      currentStep: 1,
      totalSteps: 7,
      data: {
        llm_apikey: 'sk-test',
        llm_baseurl: 'https://api.openai.com/v1',
        main_model: 'gpt-4',
        small_model: 'gpt-3.5-turbo',
        timezone: 'UTC',
      },
      skippedSteps: [],
      platform: 'telegram',
    }

    expect(session.userId).toBe('123')
    expect(session.data.llm_apikey).toBe('sk-test')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/types.test.ts
```

Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
/**
 * Wizard session types and interfaces
 */

export interface WizardSession {
  userId: string
  contextId: string
  startedAt: number
  currentStep: number
  totalSteps: number
  data: WizardData
  skippedSteps: number[]
  platform: 'telegram' | 'mattermost'
  taskProvider: 'kaneo' | 'youtrack'
}

export interface WizardData {
  llm_apikey?: string
  llm_baseurl?: string
  main_model?: string
  small_model?: string
  embedding_model?: string
  kaneo_apikey?: string
  youtrack_token?: string
  timezone?: string
}

export interface WizardStep {
  id: string
  key: keyof WizardData
  prompt: string
  validate: (value: string) => { valid: boolean; error?: string }
  liveCheck?: (value: string, data: Partial<WizardData>) => Promise<{ valid: boolean; error?: string }>
  isOptional?: boolean
}

export type WizardState = 'idle' | 'active' | 'completed' | 'cancelled'

// Platform-agnostic wizard result for bot.ts integration
export interface WizardProcessResult {
  handled: boolean
  response?: string
  requiresInput?: boolean
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/wizard/types.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/wizard/types.ts tests/wizard/types.test.ts
git commit -m "feat(wizard): add wizard session types and interfaces

Add WizardSession, WizardData, WizardStep types for configuration wizard.
Includes validation and live check interfaces."
```

---

### Task 2: Create Wizard State Store

**Files:**

- Create: `src/wizard/state.ts`
- Test: `tests/wizard/state.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  createWizardSession,
  getWizardSession,
  updateWizardSession,
  deleteWizardSession,
  hasActiveWizard,
} from '../../src/wizard/state.js'

describe('Wizard State Store', () => {
  const userId = 'test-user-123'
  const contextId = 'test-context-456'

  test('should create and retrieve session', async () => {
    const session = await createWizardSession({
      userId,
      contextId,
      totalSteps: 7,
      platform: 'telegram',
      taskProvider: 'kaneo',
    })

    expect(session.userId).toBe(userId)
    expect(session.currentStep).toBe(0)
    expect(session.data).toEqual({})

    const retrieved = await getWizardSession(userId, contextId)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.userId).toBe(userId)
  })

  test('should check active wizard', async () => {
    expect(hasActiveWizard(userId, contextId)).toBe(false)

    await createWizardSession({ userId, contextId, totalSteps: 7, platform: 'telegram', taskProvider: 'kaneo' })

    expect(hasActiveWizard(userId, contextId)).toBe(true)
  })

  test('should update session data', async () => {
    await createWizardSession({ userId, contextId, totalSteps: 7, platform: 'telegram', taskProvider: 'kaneo' })

    await updateWizardSession(userId, contextId, {
      currentStep: 1,
      data: { llm_apikey: 'sk-test' },
    })

    const session = await getWizardSession(userId, contextId)
    expect(session?.currentStep).toBe(1)
    expect(session?.data.llm_apikey).toBe('sk-test')
  })

  test('should delete session', async () => {
    await createWizardSession({ userId, contextId, totalSteps: 7, platform: 'telegram', taskProvider: 'kaneo' })
    await deleteWizardSession(userId, contextId)

    const session = await getWizardSession(userId, contextId)
    expect(session).toBeNull()
    expect(hasActiveWizard(userId, contextId)).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/state.test.ts
```

Expected: FAIL with "Module not found"

**Step 3: Write minimal implementation**

```typescript
/**
 * Wizard state management with SQLite persistence
 */

import { logger } from '../logger.js'
import type { WizardSession, WizardData } from './types.js'

const log = logger.child({ scope: 'wizard:state' })

// In-memory cache for active sessions
const activeSessions = new Map<string, WizardSession>()

function getSessionKey(userId: string, contextId: string): string {
  return `${userId}:${contextId}`
}

interface CreateSessionParams {
  userId: string
  contextId: string
  totalSteps: number
  platform: 'telegram' | 'mattermost'
  taskProvider: 'kaneo' | 'youtrack'
}

export async function createWizardSession(params: CreateSessionParams): Promise<WizardSession> {
  const session: WizardSession = {
    userId: params.userId,
    contextId: params.contextId,
    startedAt: Date.now(),
    currentStep: 0,
    totalSteps: params.totalSteps,
    data: {},
    skippedSteps: [],
    platform: params.platform,
    taskProvider: params.taskProvider,
  }

  const key = getSessionKey(params.userId, params.contextId)
  activeSessions.set(key, session)

  log.debug({ userId: params.userId, contextId: params.contextId }, 'Wizard session created')
  return session
}

export async function getWizardSession(userId: string, contextId: string): Promise<WizardSession | null> {
  const key = getSessionKey(userId, contextId)
  return activeSessions.get(key) ?? null
}

export function hasActiveWizard(userId: string, contextId: string): boolean {
  const key = getSessionKey(userId, contextId)
  return activeSessions.has(key)
}

interface UpdateSessionData {
  currentStep?: number
  data?: Partial<WizardData>
  skippedSteps?: number[]
}

export async function updateWizardSession(userId: string, contextId: string, update: UpdateSessionData): Promise<void> {
  const key = getSessionKey(userId, contextId)
  const session = activeSessions.get(key)

  if (session === undefined) {
    log.warn({ userId, contextId }, 'Attempted to update non-existent wizard session')
    return
  }

  if (update.currentStep !== undefined) {
    session.currentStep = update.currentStep
  }

  if (update.data !== undefined) {
    session.data = { ...session.data, ...update.data }
  }

  if (update.skippedSteps !== undefined) {
    session.skippedSteps = update.skippedSteps
  }

  log.debug({ userId, contextId, currentStep: session.currentStep }, 'Wizard session updated')
}

export async function deleteWizardSession(userId: string, contextId: string): Promise<void> {
  const key = getSessionKey(userId, contextId)
  activeSessions.delete(key)
  log.debug({ userId, contextId }, 'Wizard session deleted')
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/wizard/state.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/wizard/state.ts tests/wizard/state.test.ts
git commit -m "feat(wizard): add wizard state management

Add in-memory session storage with create, update, delete operations.
Includes hasActiveWizard() for checking wizard state."
```

---

### Task 3: Create Wizard Step Definitions

**Files:**

- Create: `src/wizard/steps.ts`
- Test: `tests/wizard/steps.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, test } from 'bun:test'
import { getWizardSteps, validateStep } from '../../src/wizard/steps.js'

describe('Wizard Steps', () => {
  test('should return all steps', () => {
    const steps = getWizardSteps('kaneo')
    expect(steps.length).toBeGreaterThan(0)
    expect(steps[0]?.id).toBe('llm_apikey')
  })

  test('should validate API key', () => {
    const result = validateStep('llm_apikey', 'sk-test-key')
    expect(result.valid).toBe(true)
  })

  test('should reject empty API key', () => {
    const result = validateStep('llm_apikey', '')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('API key')
  })

  test('should validate timezone', () => {
    const result = validateStep('timezone', 'America/New_York')
    expect(result.valid).toBe(true)
  })

  test('should reject invalid timezone', () => {
    const result = validateStep('timezone', 'Invalid/Timezone')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('timezone')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/steps.test.ts
```

Expected: FAIL with "Module not found"

**Step 3: Write minimal implementation**

```typescript
/**
 * Wizard step definitions and validation
 */

import { logger } from '../logger.js'
import type { WizardStep, WizardData } from './types.js'

const log = logger.child({ scope: 'wizard:steps' })

// IANA timezone validation (basic check)
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// URL validation
function isValidUrl(url: string): boolean {
  if (url === 'default') return true
  try {
    new URL(url)
    return url.startsWith('http://') || url.startsWith('https://')
  } catch {
    return false
  }
}

export function getWizardSteps(taskProvider: 'kaneo' | 'youtrack'): WizardStep[] {
  const baseSteps: WizardStep[] = [
    {
      id: 'llm_apikey',
      key: 'llm_apikey',
      prompt: '🔑 Enter your LLM API key:',
      validate: (value: string) => {
        if (value.trim().length === 0) {
          return { valid: false, error: 'Please provide a valid API key. It should be a non-empty string.' }
        }
        return { valid: true }
      },
    },
    {
      id: 'llm_baseurl',
      key: 'llm_baseurl',
      prompt: "🌐 Enter base URL (or 'default' for OpenAI):",
      validate: (value: string) => {
        if (!isValidUrl(value)) {
          return { valid: false, error: 'Please enter a valid URL starting with http:// or https://' }
        }
        return { valid: true }
      },
    },
    {
      id: 'main_model',
      key: 'main_model',
      prompt: '🤖 Enter main model name (e.g., gpt-4, claude-3-opus):',
      validate: (value: string) => {
        if (value.trim().length === 0) {
          return { valid: false, error: 'Please enter a model name' }
        }
        return { valid: true }
      },
    },
    {
      id: 'small_model',
      key: 'small_model',
      prompt: "⚡ Enter small model name (or 'same' to use main model):",
      validate: (value: string) => {
        if (value.trim().length === 0 && value !== 'same') {
          return { valid: false, error: "Please enter a model name or 'same'" }
        }
        return { valid: true }
      },
    },
    {
      id: 'embedding_model',
      key: 'embedding_model',
      prompt: "📊 Enter embedding model (or 'skip' to use default):",
      isOptional: true,
      validate: (value: string) => {
        if (value.trim().length === 0 && value !== 'skip') {
          return { valid: false, error: "Please enter a model name or 'skip'" }
        }
        return { valid: true }
      },
    },
    {
      id: 'timezone',
      key: 'timezone',
      prompt: '🌍 Enter your timezone (e.g., America/New_York, UTC):',
      validate: (value: string) => {
        if (!isValidTimezone(value)) {
          return { valid: false, error: 'Invalid timezone. Use IANA format (e.g., America/New_York)' }
        }
        return { valid: true }
      },
    },
  ]

  const providerKey = taskProvider === 'youtrack' ? 'youtrack_token' : 'kaneo_apikey'
  const providerName = taskProvider === 'youtrack' ? 'YouTrack' : 'Kaneo'

  const providerStep: WizardStep = {
    id: providerKey,
    key: providerKey,
    prompt: `🔐 Enter your ${providerName} access token:`,
    validate: (value: string) => {
      if (value.trim().length === 0) {
        return { valid: false, error: 'Please provide a valid token' }
      }
      return { valid: true }
    },
  }

  // Insert provider step before timezone
  const providerIndex = baseSteps.findIndex((s) => s.id === 'timezone')
  baseSteps.splice(providerIndex, 0, providerStep)

  return baseSteps
}

export function validateStep(stepId: string, value: string): { valid: boolean; error?: string } {
  const steps = getWizardSteps('kaneo') // Provider doesn't matter for validation
  const step = steps.find((s) => s.id === stepId)

  if (step === undefined) {
    return { valid: false, error: 'Unknown step' }
  }

  return step.validate(value)
}

export function getStepByIndex(taskProvider: 'kaneo' | 'youtrack', index: number): WizardStep | null {
  const steps = getWizardSteps(taskProvider)
  return steps[index] ?? null
}

export function formatSummary(data: WizardData, taskProvider: 'kaneo' | 'youtrack'): string {
  const mask = (value: string | undefined): string => {
    if (value === undefined) return '(not set)'
    if (value.length <= 8) return '****'
    return `****${value.slice(-4)}`
  }

  const providerKey = taskProvider === 'youtrack' ? 'youtrack_token' : 'kaneo_apikey'
  const providerName = taskProvider === 'youtrack' ? 'YouTrack Token' : 'Kaneo API Key'

  return [
    '📋 Configuration Summary:',
    '',
    `• LLM API Key: ${mask(data.llm_apikey)}`,
    `• Base URL: ${data.llm_baseurl ?? '(not set)'}`,
    `• Main Model: ${data.main_model ?? '(not set)'}`,
    `• Small Model: ${data.small_model ?? '(not set)'}`,
    `• Embedding Model: ${data.embedding_model ?? '(default)'}`,
    `• ${providerName}: ${mask(data[providerKey])}`,
    `• Timezone: ${data.timezone ?? '(not set)'}`,
  ].join('\n')
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/wizard/steps.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/wizard/steps.ts tests/wizard/steps.test.ts
git commit -m "feat(wizard): add wizard step definitions and validation

Define wizard steps for all configuration keys with validation logic.
Includes timezone, URL, and required field validation."
```

---

## Phase 2: Live Validation

### Task 4: Create Live Validation Service

**Files:**

- Create: `src/wizard/validation.ts`
- Test: `tests/wizard/validation.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, test } from 'bun:test'
import { validateLlmApiKey, validateLlmBaseUrl, validateModelExists } from '../../src/wizard/validation.js'

describe('Live Validation', () => {
  test('should validate API key with test call', async () => {
    const result = await validateLlmApiKey('sk-test', 'https://api.openai.com/v1')
    expect(result.valid).toBe(true)
  })

  test('should reject invalid API key', async () => {
    const result = await validateLlmApiKey('invalid-key', 'https://api.openai.com/v1')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('API key')
  })

  test('should validate base URL', async () => {
    const result = await validateLlmBaseUrl('https://api.openai.com/v1')
    expect(result.valid).toBe(true)
  })

  test('should reject unreachable URL', async () => {
    const result = await validateLlmBaseUrl('http://localhost:99999')
    expect(result.valid).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/validation.test.ts
```

Expected: FAIL with "Module not found"

**Step 3: Write minimal implementation**

```typescript
/**
 * Live validation service for wizard configuration
 */

import { logger } from '../logger.js'

const log = logger.child({ scope: 'wizard:validation' })

interface ValidationResult {
  valid: boolean
  error?: string
}

export async function validateLlmApiKey(apiKey: string, baseUrl: string): Promise<ValidationResult> {
  try {
    const url = baseUrl === 'default' ? 'https://api.openai.com/v1' : baseUrl
    const response = await fetch(`${url}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (response.status === 401) {
      return { valid: false, error: '❌ Invalid API key. Please check and try again.' }
    }

    if (!response.ok) {
      return { valid: false, error: `❌ API error: ${response.status} ${response.statusText}` }
    }

    return { valid: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'API key validation failed')
    return { valid: false, error: '❌ Connection failed. Please check your internet connection.' }
  }
}

export async function validateLlmBaseUrl(baseUrl: string): Promise<ValidationResult> {
  if (baseUrl === 'default') {
    return { valid: true }
  }

  try {
    const response = await fetch(baseUrl, { method: 'HEAD' })
    if (!response.ok && response.status !== 404) {
      return { valid: false, error: `❌ Server returned error: ${response.status}` }
    }
    return { valid: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Base URL validation failed')
    return { valid: false, error: '❌ Cannot connect to the provided URL. Please check and try again.' }
  }
}

export async function validateModelExists(
  modelName: string,
  apiKey: string,
  baseUrl: string,
): Promise<ValidationResult> {
  if (modelName === 'same') {
    return { valid: true }
  }

  try {
    const url = baseUrl === 'default' ? 'https://api.openai.com/v1' : baseUrl
    const response = await fetch(`${url}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      return { valid: false, error: '❌ Could not fetch model list' }
    }

    const data = (await response.json()) as { data?: Array<{ id: string }> }
    const models = data.data ?? []
    const exists = models.some((m) => m.id === modelName)

    if (!exists) {
      const suggestions = models
        .slice(0, 3)
        .map((m) => m.id)
        .join(', ')
      return {
        valid: false,
        error: `❌ Model '${modelName}' not found. Some available models: ${suggestions}...`,
      }
    }

    return { valid: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Model validation failed')
    return { valid: false, error: '❌ Could not verify model. Please try again.' }
  }
}

export async function validateProviderToken(
  token: string,
  taskProvider: 'kaneo' | 'youtrack',
  baseUrl?: string,
): Promise<ValidationResult> {
  // Provider-specific validation would go here
  // For now, just check it's not empty
  if (token.trim().length === 0) {
    return { valid: false, error: '❌ Token cannot be empty' }
  }

  // TODO: Add actual provider API validation
  // For Kaneo: Test connection to API
  // For YouTrack: Test connection to YouTrack instance

  return { valid: true }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/wizard/validation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/wizard/validation.ts tests/wizard/validation.test.ts
git commit -m "feat(wizard): add live validation service

Add real-time validation for API keys, base URLs, and models.
Makes actual HTTP requests to verify connectivity."
```

---

## Phase 3: Wizard Engine Core

### Task 5: Create Wizard Engine

**Files:**

- Create: `src/wizard/engine.ts`
- Test: `tests/wizard/engine.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, test, beforeEach } from 'bun:test'
import { createWizard, advanceStep, getCurrentPrompt, saveWizardConfig } from '../../src/wizard/engine.js'

describe('Wizard Engine', () => {
  const userId = 'test-user'
  const contextId = 'test-context'

  beforeEach(async () => {
    // Clean up any existing sessions
    const { deleteWizardSession } = await import('../../src/wizard/state.js')
    await deleteWizardSession(userId, contextId)
  })

  test('should create wizard', async () => {
    const result = await createWizard(userId, contextId, 'telegram', 'kaneo')
    expect(result.success).toBe(true)
    expect(result.prompt).toContain('LLM API key')
  })

  test('should advance step', async () => {
    await createWizard(userId, contextId, 'telegram', 'kaneo')

    const result = await advanceStep(userId, contextId, 'sk-test-key', false)
    expect(result.success).toBe(true)
    expect(result.isComplete).toBe(false)
    expect(result.prompt).toContain('base URL')
  })

  test('should complete wizard', async () => {
    await createWizard(userId, contextId, 'telegram', 'kaneo')

    // Simulate completing all steps
    const steps = ['sk-key', 'https://api.openai.com/v1', 'gpt-4', 'gpt-3.5', 'skip', 'kaneo-token', 'UTC']

    for (const value of steps) {
      const result = await advanceStep(userId, contextId, value, false)
      if (!result.isComplete) {
        expect(result.success).toBe(true)
      }
    }
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/engine.test.ts
```

Expected: FAIL with "Module not found"

**Step 3: Write minimal implementation**

```typescript
/**
 * Wizard engine - orchestrates the configuration wizard flow
 */

import { logger } from '../logger.js'
import { setConfig } from '../config.js'
import { createWizardSession, updateWizardSession, getWizardSession, deleteWizardSession } from './state.js'
import { getWizardSteps, getStepByIndex, formatSummary } from './steps.js'
import { validateLlmApiKey, validateLlmBaseUrl, validateModelExists, validateProviderToken } from './validation.js'
import type { WizardData, WizardProcessResult } from './types.js'

const log = logger.child({ scope: 'wizard:engine' })

interface WizardResult {
  success: boolean
  prompt?: string
  error?: string
  isComplete?: boolean
  summary?: string
}

export async function createWizard(
  userId: string,
  contextId: string,
  platform: 'telegram' | 'mattermost',
  taskProvider: 'kaneo' | 'youtrack',
): Promise<WizardResult> {
  const steps = getWizardSteps(taskProvider)

  await createWizardSession({ userId, contextId, totalSteps: steps.length, platform, taskProvider })

  const firstStep = steps[0]
  if (firstStep === undefined) {
    return { success: false, error: 'No steps defined' }
  }

  log.info({ userId, contextId, platform }, 'Wizard created')

  return {
    success: true,
    prompt: `👋 Welcome! Let's set up your AI assistant.\n\n${firstStep.prompt}`,
  }
}

export async function advanceStep(
  userId: string,
  contextId: string,
  value: string,
  skipValidation: boolean,
): Promise<WizardResult> {
  const session = await getWizardSession(userId, contextId)
  if (session === null) {
    return { success: false, error: 'No active wizard session. Type /setup to start.' }
  }

  const currentStep = getStepByIndex(session.taskProvider, session.currentStep)

  if (currentStep === null) {
    return { success: false, error: 'Invalid wizard state' }
  }

  // Handle skip
  if (value.toLowerCase() === 'skip') {
    if (!currentStep.isOptional) {
      return { success: false, error: 'This step cannot be skipped' }
    }

    await updateWizardSession(userId, contextId, {
      currentStep: session.currentStep + 1,
      skippedSteps: [...session.skippedSteps, session.currentStep],
    })

    return getNextPrompt(userId, contextId)
  }

  // Basic validation
  const basicValidation = currentStep.validate(value)
  if (!basicValidation.valid) {
    return { success: false, error: basicValidation.error }
  }

  // Live validation (if enabled and not skipped)
  if (!skipValidation && currentStep.liveCheck !== undefined) {
    const liveResult = await currentStep.liveCheck(value, session.data)
    if (!liveResult.valid) {
      return { success: false, error: liveResult.error }
    }
  }

  // Store value
  const normalizedValue = normalizeValue(currentStep.key, value, session.data)
  await updateWizardSession(userId, contextId, {
    currentStep: session.currentStep + 1,
    data: { [currentStep.key]: normalizedValue },
  })

  log.debug({ userId, contextId, step: currentStep.id }, 'Wizard step completed')

  // Check if complete
  const steps = getWizardSteps(session.taskProvider)
  if (session.currentStep + 1 >= steps.length) {
    return showSummary(userId, contextId, session.taskProvider)
  }

  return getNextPrompt(userId, contextId)
}

function normalizeValue(key: keyof WizardData, value: string, data: Partial<WizardData>): string {
  if (key === 'small_model' && value === 'same') {
    return data.main_model ?? value
  }
  if (key === 'llm_baseurl' && value === 'default') {
    return 'https://api.openai.com/v1'
  }
  if (key === 'embedding_model' && value === 'skip') {
    return ''
  }
  return value
}

async function getNextPrompt(userId: string, contextId: string): Promise<WizardResult> {
  const session = await getWizardSession(userId, contextId)
  if (session === null) {
    return { success: false, error: 'Session expired' }
  }

  const nextStep = getStepByIndex(session.taskProvider, session.currentStep)

  if (nextStep === null) {
    return { success: false, error: 'No more steps' }
  }

  let prompt = nextStep.prompt
  if (nextStep.isOptional) {
    prompt += '\n\n(Type "skip" to skip this optional step)'
  }

  return { success: true, prompt }
}

async function showSummary(
  userId: string,
  contextId: string,
  taskProvider: 'kaneo' | 'youtrack',
): Promise<WizardResult> {
  const session = await getWizardSession(userId, contextId)
  if (session === null) {
    return { success: false, error: 'Session expired' }
  }

  const summary = formatSummary(session.data, taskProvider)

  return {
    success: true,
    isComplete: true,
    summary,
    prompt: `${summary}\n\n✅ Everything look correct? Type "yes" to save, or "edit" to modify.`,
  }
}

export async function saveWizardConfig(userId: string, contextId: string, confirmed: boolean): Promise<WizardResult> {
  if (!confirmed) {
    return { success: false, error: 'Configuration cancelled. Type /setup to restart.' }
  }

  const session = await getWizardSession(userId, contextId)
  if (session === null) {
    return { success: false, error: 'Session expired' }
  }

  // Save all config values
  for (const [key, value] of Object.entries(session.data)) {
    if (value !== undefined && value !== '') {
      setConfig(contextId, key as keyof WizardData, value)
    }
  }

  await deleteWizardSession(userId, contextId)

  log.info({ userId, contextId }, 'Wizard configuration saved')

  return {
    success: true,
    isComplete: true,
    prompt: '✅ Configuration saved successfully! You can now start using the bot.',
  }
}

export async function cancelWizard(userId: string, contextId: string): Promise<void> {
  await deleteWizardSession(userId, contextId)
  log.info({ userId, contextId }, 'Wizard cancelled')
}

export async function restartWizardStep(userId: string, contextId: string): Promise<WizardResult> {
  const session = await getWizardSession(userId, contextId)
  if (session === null || session.currentStep === 0) {
    return { success: false, error: 'Cannot restart' }
  }

  await updateWizardSession(userId, contextId, {
    currentStep: session.currentStep - 1,
  })

  return getNextPrompt(userId, contextId)
}

// Platform-agnostic wizard message processor for bot.ts
export async function processWizardMessage(
  userId: string,
  contextId: string,
  text: string,
): Promise<WizardProcessResult> {
  const session = await getWizardSession(userId, contextId)

  if (session === null) {
    return { handled: false }
  }

  // Handle cancellation
  if (text.toLowerCase() === 'cancel') {
    await cancelWizard(userId, contextId)
    return {
      handled: true,
      response: '❌ Wizard cancelled. Type /setup to restart.',
    }
  }

  // Handle confirmation
  if (text.toLowerCase() === 'yes' || text.toLowerCase() === 'confirm') {
    const result = await saveWizardConfig(userId, contextId, true)
    return {
      handled: true,
      response: result.prompt ?? 'Configuration saved!',
    }
  }

  // Handle step advancement
  const result = await advanceStep(userId, contextId, text, false)

  if (result.success) {
    return {
      handled: true,
      response: result.isComplete ? (result.summary ?? result.prompt) : result.prompt,
      requiresInput: !result.isComplete,
    }
  } else {
    return {
      handled: true,
      response: result.error ?? 'Invalid input. Please try again.',
      requiresInput: true,
    }
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/wizard/engine.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/wizard/engine.ts tests/wizard/engine.test.ts
git commit -m "feat(wizard): add wizard engine

Add core wizard orchestration with step advancement, validation,
summary display, and config saving. Includes processWizardMessage() for bot.ts integration."
```

---

## Phase 4: Platform Integration (Corrected Architecture)

### Task 6: Add Wizard Callback Handler to Telegram Provider

**Files:**

- Modify: `src/chat/telegram/index.ts` (add callback handler in start method)
- Create: `src/wizard/telegram-handlers.ts` (callback handler)

**Step 1: Create Telegram callback handler**

Create `src/wizard/telegram-handlers.ts`:

```typescript
/**
 * Telegram-specific wizard callback handlers
 * Called from TelegramChatProvider.start()
 */

import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import { logger } from '../logger.js'
import { saveWizardConfig, cancelWizard } from './engine.js'
import { getWizardSession } from './state.js'

const log = logger.child({ scope: 'wizard:telegram' })

export async function handleWizardCallback(ctx: Context): Promise<void> {
  const userId = String(ctx.from?.id ?? '')
  const contextId = String(ctx.chat?.id ?? userId)
  const data = (ctx.callbackQuery as { data?: string })?.data ?? ''

  if (userId === '' || contextId === '') {
    return
  }

  // Only handle wizard-related callbacks
  if (!data.startsWith('wizard_')) {
    return
  }

  await ctx.answerCallbackQuery()

  switch (data) {
    case 'wizard_confirm':
      await saveWizardConfig(userId, contextId, true)
      await ctx.editMessageText('✅ Configuration saved successfully!')
      break
    case 'wizard_cancel':
      await cancelWizard(userId, contextId)
      await ctx.editMessageText('❌ Wizard cancelled. Type /setup to restart.')
      break
    case 'wizard_restart':
      await cancelWizard(userId, contextId)
      await ctx.reply('Restarting wizard... Type /setup to begin.')
      break
  }
}

export function buildWizardKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ Cancel', 'wizard_cancel')
}

export function buildSummaryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Confirm', 'wizard_confirm')
    .text('🔄 Restart', 'wizard_restart')
    .text('❌ Cancel', 'wizard_cancel')
}
```

**Step 2: Modify Telegram provider to register callback handler**

In `src/chat/telegram/index.ts`, modify the `start()` method:

```typescript
// Add import
import { handleWizardCallback } from '../../wizard/telegram-handlers.js'

// In start() method, add callback handler:
start(): Promise<void> {
  // Register wizard callback handler
  this.bot.on('callback_query:data', async (ctx) => {
    await handleWizardCallback(ctx)
  })

  return new Promise<void>((resolve, reject) => {
    this.bot
      .start({
        onStart: (botInfo) => {
          this.botUsername = botInfo.username
          log.info({ botUsername: this.botUsername }, 'Telegram bot is running')
          resolve()
        },
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        log.error({ error: err.message }, 'Telegram polling loop exited')
        reject(err)
      })
  })
}
```

**Step 3: DO NOT modify onMessage**

The `onMessage` method remains unchanged. Wizard interception happens in `bot.ts`.

**Step 4: Commit**

```bash
git add src/wizard/telegram-handlers.ts src/chat/telegram/index.ts
git commit -m "feat(telegram): add wizard callback handlers

Register callback query handler in Telegram provider.start().
DO NOT modify onMessage - wizard interception happens in bot.ts."
```

---

### Task 7: Integrate Wizard into Bot.ts (Platform-Agnostic)

**Files:**

- Modify: `src/bot.ts`

**Step 1: Read current bot.ts structure**

Already read - shows `onMessage` is called once from `setupBot()` with a single handler.

**Step 2: Modify bot.ts to add wizard interception**

```typescript
// Add imports at top
import { registerSetupCommand } from './commands/setup.js'
import { hasActiveWizard, processWizardMessage } from './wizard/index.js'

// In setupBot function, add setup command registration
export function setupBot(chat: ChatProvider, adminUserId: string): void {
  registerHelpCommand(chat)
  registerSetupCommand(chat, checkAuthorization)
  registerSetCommand(chat, checkAuthorization)
  registerConfigCommand(chat, checkAuthorization)
  registerContextCommand(chat, adminUserId)
  registerClearCommand(chat, checkAuthorization, adminUserId)
  registerAdminCommands(chat, adminUserId)
  registerGroupCommand(chat)

  chat.onMessage(async (msg, reply) => {
    // WIZARD INTERCEPTION - Platform agnostic
    // Check if user is in active wizard session AND message is not a command
    // Commands (starting with /) are always routed to their handlers, even during wizard
    const isCommand = msg.text.startsWith('/')

    if (hasActiveWizard(msg.user.id, msg.contextId) && !isCommand) {
      const wizardResult = await processWizardMessage(msg.user.id, msg.contextId, msg.text)

      if (wizardResult.handled) {
        if (wizardResult.response) {
          await reply.text(wizardResult.response)
        }
        return
      }
    }

    // Existing authorization and message processing
    const auth = checkAuthorizationExtended(
      msg.user.id,
      msg.user.username,
      msg.contextId,
      msg.contextType,
      msg.user.isAdmin,
    )

    if (!auth.allowed) {
      if (msg.isMentioned) {
        await reply.text(
          "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser @{username}`",
        )
      }
      return
    }

    const hasCommand = msg.commandMatch !== undefined && msg.commandMatch !== ''
    const isNaturalLanguage = !hasCommand
    if (msg.contextType === 'group' && isNaturalLanguage && !msg.isMentioned) {
      return
    }

    reply.typing()
    const prompt = buildPromptWithReplyContext(msg)
    await processMessage(reply, auth.storageContextId, msg.user.username, prompt)
  })
}
```

**Step 3: Create wizard index.ts for clean exports**

Create `src/wizard/index.ts`:

```typescript
/**
 * Wizard module exports
 */

export { hasActiveWizard } from './state.js'
export { processWizardMessage } from './engine.js'
export { createWizard } from './engine.js'
export type { WizardProcessResult } from './types.js'
```

**Step 4: Commit**

```bash
git add src/bot.ts src/wizard/index.ts
git commit -m "feat(bot): integrate wizard into message flow (platform-agnostic)

Add wizard interception in bot.ts before authorization check.
Wizard state check is platform-agnostic, callbacks handled by providers.
Maintains existing architecture where bot.ts is the orchestration layer."
```

---

### Task 8: Create Setup Command

**Files:**

- Create: `src/commands/setup.ts`
- Modify: `src/commands/index.ts`
- Test: `tests/commands/setup.test.ts`

**Step 1: Create setup command**

```typescript
import type { ChatProvider, CommandHandler, AuthorizationResult } from '../chat/types.js'
import { logger } from '../logger.js'
import { createWizard } from '../wizard/engine.js'

const log = logger.child({ scope: 'commands:setup' })

const TASK_PROVIDER = (process.env['TASK_PROVIDER'] as 'kaneo' | 'youtrack') ?? 'kaneo'

export function registerSetupCommand(
  chat: ChatProvider,
  checkAuthorization: (userId: string, username?: string | null) => boolean,
): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) {
      await reply.text('You are not authorized to use this bot.')
      return
    }

    log.info({ userId: msg.user.id, contextId: auth.storageContextId }, '/setup command executed')

    // Create wizard session - actual prompts handled by wizard engine
    const platform = chat.name as 'telegram' | 'mattermost'
    const result = await createWizard(msg.user.id, auth.storageContextId, platform, TASK_PROVIDER)

    if (result.success && result.prompt) {
      await reply.text(result.prompt)
    } else {
      await reply.text(result.error ?? 'Failed to start wizard. Please try again.')
    }
  }

  chat.registerCommand('setup', handler)
}
```

**Step 2: Update commands index**

```typescript
export { registerAdminCommands } from './admin.js'
export { registerClearCommand } from './clear.js'
export { registerConfigCommand } from './config.js'
export { registerContextCommand } from './context.js'
export { registerGroupCommand } from './group.js'
export { registerHelpCommand } from './help.js'
export { registerSetCommand } from './set.js'
export { registerSetupCommand } from './setup.js'
```

**Step 3: Commit**

```bash
git add src/commands/setup.ts src/commands/index.ts
git commit -m "feat(commands): add /setup command

Add setup command that creates wizard session and triggers first prompt.
Wizard engine handles subsequent messages via bot.ts interception."
```

---

## Phase 5: Mattermost Integration

### Task 9: Create Mattermost Wizard Handler

**Files:**

- Create: `src/wizard/mattermost-handlers.ts`

**Step 1: Create Mattermost handler**

```typescript
/**
 * Mattermost-specific wizard handlers
 */

import { logger } from '../logger.js'
import { createWizard, saveWizardConfig, cancelWizard } from './engine.js'

const log = logger.child({ scope: 'wizard:mattermost' })

const TASK_PROVIDER = (process.env['TASK_PROVIDER'] as 'kaneo' | 'youtrack') ?? 'kaneo'

interface MattermostContext {
  userId: string
  contextId: string
  channelId: string
  triggerId?: string
}

export async function handleMattermostWizardCommand(
  ctx: MattermostContext,
  text: string,
): Promise<{ response_type: string; text: string }> {
  if (text.trim() === '' || text === 'setup') {
    const result = await createWizard(ctx.userId, ctx.contextId, 'mattermost', TASK_PROVIDER)

    if (result.success && result.prompt) {
      return {
        response_type: 'ephemeral',
        text: result.prompt,
      }
    }

    return {
      response_type: 'ephemeral',
      text: result.error ?? 'Failed to start wizard',
    }
  }

  return {
    response_type: 'ephemeral',
    text: 'Unknown command. Use `/papai-setup` to start the wizard.',
  }
}

export function buildConfigDialog(): Record<string, unknown> {
  return {
    title: '⚙️ Configuration',
    icon_url: '',
    callback_id: 'papai_config_dialog',
    elements: [
      {
        type: 'select',
        label: 'Select setting to configure',
        options: [
          { text: '🤖 LLM Settings', value: 'llm' },
          { text: '📋 Provider Settings', value: 'provider' },
          { text: '🌍 General Settings', value: 'general' },
        ],
      },
    ],
    submit_label: 'Configure',
  }
}
```

**Step 2: Commit**

```bash
git add src/wizard/mattermost-handlers.ts
git commit -m "feat(mattermost): add wizard handlers for Mattermost

Add Mattermost-specific command handler and dialog builders.
Wizard flow still handled by platform-agnostic engine."
```

---

## Phase 6: Commands Update

### Task 10: Update Set Command

**Files:**

- Modify: `src/commands/set.ts`

**Step 1: Modify set command**

Add helpful message when called without arguments:

```typescript
const match = (msg.commandMatch ?? '').trim()
if (match === '') {
  await reply.text(
    '💡 **Configuration Help**\n\n' +
      'Use `/setup` for an interactive wizard (recommended)\n' +
      'Or use `/set <key> <value>` for manual configuration\n\n' +
      'Example: `/set llm_apikey sk-...`',
  )
  return
}
```

**Step 2: Commit**

```bash
git add src/commands/set.ts
git commit -m "feat(commands): update /set to show wizard suggestion

When /set is called without arguments, suggest the wizard first."
```

---

### Task 11: Update Config Command

**Files:**

- Modify: `src/commands/config.ts`

**Step 1: Modify config command**

Add hint after showing config:

```typescript
await reply.text(lines.join('\n') + '\n\n💡 Use `/setup` to edit configuration interactively.')
```

**Step 2: Commit**

```bash
git add src/commands/config.ts
git commit -m "feat(commands): update /config with wizard hint

Add helpful message suggesting /setup for interactive editing."
```

---

## Phase 7: Testing & Finalization

### Task 12: Create Wizard Integration Tests

**Files:**

- Create: `tests/wizard/integration.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, expect, test, beforeEach } from 'bun:test'
import { createWizard, advanceStep, saveWizardConfig, processWizardMessage } from '../../src/wizard/engine.js'
import { hasActiveWizard, deleteWizardSession } from '../../src/wizard/state.js'

describe('Wizard Integration', () => {
  const userId = 'test-user'
  const contextId = 'test-context'

  beforeEach(async () => {
    await deleteWizardSession(userId, contextId)
  })

  test('should complete full wizard flow', async () => {
    // Start wizard
    const startResult = await createWizard(userId, contextId, 'telegram', 'kaneo')
    expect(startResult.success).toBe(true)
    expect(hasActiveWizard(userId, contextId)).toBe(true)

    // Complete all steps
    const steps = ['sk-api-key', 'https://api.openai.com/v1', 'gpt-4', 'same', 'skip', 'kaneo-token', 'UTC']

    for (const value of steps) {
      const result = await advanceStep(userId, contextId, value, true)
      expect(result.success).toBe(true)
    }

    // Confirm
    const saveResult = await saveWizardConfig(userId, contextId, true)
    expect(saveResult.success).toBe(true)
    expect(hasActiveWizard(userId, contextId)).toBe(false)
  })

  test('should handle processWizardMessage', async () => {
    await createWizard(userId, contextId, 'telegram', 'kaneo')

    const result = await processWizardMessage(userId, contextId, 'sk-test-key')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('base URL')
  })
})
```

**Step 2: Run test**

```bash
bun test tests/wizard/integration.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add tests/wizard/integration.test.ts
git commit -m "test(wizard): add integration tests

Test complete wizard flow including platform-agnostic message processing."
```

---

### Task 13: Final Verification

**Step 1: Run all tests**

```bash
bun test
```

**Step 2: Type checking**

```bash
bun typecheck
```

**Step 3: Linting**

```bash
bun lint
```

**Step 4: Format**

```bash
bun format
```

**Step 5: Commit**

```bash
git commit -m "chore: final verification of wizard implementation

- All tests passing
- Type checking passes
- Linting passes
- Formatting applied"
```

---

## Summary

### Corrected Architecture

```
✅ Platform-Agnostic Design:
   - bot.ts checks hasActiveWizard() before processing
   - processWizardMessage() handles wizard logic
   - Providers unchanged (no interception in onMessage)

✅ Platform-Specific Code:
   - Telegram: Callback handlers in telegram-handlers.ts
   - Mattermost: Command handlers in mattermost-handlers.ts
   - Registered in provider.start(), not onMessage

✅ Clean Separation:
   - Wizard engine is platform-agnostic
   - UI adapters handle platform specifics
   - ChatProvider interface unchanged
```

### Files Created

```
src/wizard/
├── index.ts                    # Clean exports
├── types.ts                    # Type definitions
├── state.ts                    # Session management
├── steps.ts                    # Step definitions
├── validation.ts               # Live validation
├── engine.ts                   # Core engine
├── telegram-handlers.ts        # Telegram callbacks
└── mattermost-handlers.ts      # Mattermost handlers

src/commands/
└── setup.ts                    # Setup command

tests/wizard/
├── types.test.ts
├── state.test.ts
├── steps.test.ts
├── validation.test.ts
├── engine.test.ts
└── integration.test.ts
```

### Files Modified

```
src/bot.ts                      # Add wizard interception
src/commands/index.ts           # Export setup command
src/commands/set.ts             # Suggest wizard
src/commands/config.ts          # Add wizard hint
src/chat/telegram/index.ts      # Register callbacks in start()
```

---

**Plan complete with corrected architecture. The wizard now maintains platform-agnostic design while providing platform-native UIs.**
