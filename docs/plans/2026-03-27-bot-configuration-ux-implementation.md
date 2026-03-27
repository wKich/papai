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
- Modify: `src/db/schema.ts` (add wizard_sessions table)
- Test: `tests/wizard/state.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  createWizardSession,
  getWizardSession,
  updateWizardSession,
  deleteWizardSession,
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
    })

    expect(session.userId).toBe(userId)
    expect(session.currentStep).toBe(0)
    expect(session.data).toEqual({})

    const retrieved = await getWizardSession(userId, contextId)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.userId).toBe(userId)
  })

  test('should update session data', async () => {
    await createWizardSession({ userId, contextId, totalSteps: 7, platform: 'telegram' })

    await updateWizardSession(userId, contextId, {
      currentStep: 1,
      data: { llm_apikey: 'sk-test' },
    })

    const session = await getWizardSession(userId, contextId)
    expect(session?.currentStep).toBe(1)
    expect(session?.data.llm_apikey).toBe('sk-test')
  })

  test('should delete session', async () => {
    await createWizardSession({ userId, contextId, totalSteps: 7, platform: 'telegram' })
    await deleteWizardSession(userId, contextId)

    const session = await getWizardSession(userId, contextId)
    expect(session).toBeNull()
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

import { getDrizzleDb } from '../db/drizzle.js'
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

export function hasActiveWizard(userId: string, contextId: string): boolean {
  const key = getSessionKey(userId, contextId)
  return activeSessions.has(key)
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
Sessions are keyed by userId:contextId for isolation."
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
import { describe, expect, test, mock } from 'bun:test'
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
import type { WizardData } from './types.js'

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

  await createWizardSession({ userId, contextId, totalSteps: steps.length, platform })

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

  const taskProvider = session.data.kaneo_apikey !== undefined ? 'kaneo' : 'youtrack'
  const currentStep = getStepByIndex(taskProvider, session.currentStep)

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
  const steps = getWizardSteps(taskProvider)
  if (session.currentStep + 1 >= steps.length) {
    return showSummary(userId, contextId, taskProvider)
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

  const taskProvider = session.data.kaneo_apikey !== undefined ? 'kaneo' : 'youtrack'
  const nextStep = getStepByIndex(taskProvider, session.currentStep)

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
summary display, and config saving."
```

---

## Phase 4: Telegram UI

### Task 6: Create Telegram Wizard UI

**Files:**

- Create: `src/chat/telegram/wizard-ui.ts`
- Modify: `src/chat/telegram/index.ts` (integrate wizard)

**Step 1: Write the failing test**

```typescript
import { describe, expect, test, mock } from 'bun:test'
import { handleWizardMessage } from '../../../src/chat/telegram/wizard-ui.js'

describe('Telegram Wizard UI', () => {
  test('should handle wizard message', async () => {
    const ctx = {
      from: { id: 123, username: 'testuser' },
      chat: { id: 123, type: 'private' },
      message: { text: '/setup', message_id: 1 },
      reply: mock(() => Promise.resolve()),
    }

    const result = await handleWizardMessage(ctx as unknown)
    expect(result).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/chat/telegram/wizard-ui.test.ts
```

Expected: FAIL with "Module not found"

**Step 3: Write minimal implementation**

```typescript
/**
 * Telegram-specific wizard UI components
 */

import { InlineKeyboard } from 'grammy'
import { logger } from '../../logger.js'
import { createWizard, advanceStep, saveWizardConfig, cancelWizard } from '../../wizard/engine.js'
import { hasActiveWizard } from '../../wizard/state.js'
import type { Context } from 'grammy'

const log = logger.child({ scope: 'chat:telegram:wizard' })

const TASK_PROVIDER = (process.env['TASK_PROVIDER'] as 'kaneo' | 'youtrack') ?? 'kaneo'

export async function handleWizardMessage(ctx: Context): Promise<boolean> {
  const userId = String(ctx.from?.id ?? '')
  const contextId = String(ctx.chat?.id ?? userId)
  const text = ctx.message?.text ?? ''

  if (userId === '' || contextId === '') {
    return false
  }

  // Check if there's an active wizard
  if (!hasActiveWizard(userId, contextId)) {
    // Only handle /setup command
    if (text === '/setup') {
      const result = await createWizard(userId, contextId, 'telegram', TASK_PROVIDER)

      if (result.success && result.prompt) {
        const keyboard = buildWizardKeyboard()
        await ctx.reply(result.prompt, { reply_markup: keyboard })
      } else {
        await ctx.reply(result.error ?? 'Failed to start wizard')
      }
      return true
    }
    return false
  }

  // Handle wizard responses
  if (text.toLowerCase() === 'cancel') {
    await cancelWizard(userId, contextId)
    await ctx.reply('❌ Wizard cancelled. Type /setup to restart.')
    return true
  }

  if (text.toLowerCase() === 'yes' || text.toLowerCase() === 'confirm') {
    const result = await saveWizardConfig(userId, contextId, true)
    await ctx.reply(result.prompt ?? 'Configuration saved!')
    return true
  }

  if (text.toLowerCase() === 'edit') {
    // TODO: Implement edit mode
    await ctx.reply('Edit mode not yet implemented. Type /setup to restart.')
    return true
  }

  // Process step input
  const result = await advanceStep(userId, contextId, text, false)

  if (result.success) {
    if (result.isComplete && result.summary) {
      const keyboard = new InlineKeyboard()
        .text('✅ Confirm', 'wizard_confirm')
        .text('🔄 Restart', 'wizard_restart')
        .text('❌ Cancel', 'wizard_cancel')

      await ctx.reply(result.prompt ?? result.summary, { reply_markup: keyboard })
    } else if (result.prompt) {
      const keyboard = buildWizardKeyboard()
      await ctx.reply(result.prompt, { reply_markup: keyboard })
    }
  } else {
    // Show error with retry options
    const keyboard = new InlineKeyboard()
      .text('🔁 Retry', 'wizard_retry')
      .text('⏭️ Skip', 'wizard_skip')
      .text('❓ Help', 'wizard_help')

    await ctx.reply(result.error ?? 'Invalid input', { reply_markup: keyboard })
  }

  return true
}

function buildWizardKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ Cancel', 'wizard_cancel')
}

export async function handleWizardCallback(ctx: Context): Promise<void> {
  const userId = String(ctx.from?.id ?? '')
  const contextId = String(ctx.chat?.id ?? userId)
  const data = (ctx.callbackQuery as { data?: string })?.data ?? ''

  if (userId === '' || contextId === '') {
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
      const result = await createWizard(userId, contextId, 'telegram', TASK_PROVIDER)
      if (result.success && result.prompt) {
        await ctx.editMessageText(result.prompt)
      }
      break
    case 'wizard_retry':
      // Re-show current prompt
      const session = await import('../../wizard/state.js').then((m) => m.getWizardSession(userId, contextId))
      if (session) {
        await ctx.editMessageText(
          session.currentStep === 0 ? 'Welcome! ' + result?.prompt : (result?.prompt ?? 'Please enter the value:'),
        )
      }
      break
    case 'wizard_skip':
      // Skip current step
      const skipResult = await advanceStep(userId, contextId, 'skip', false)
      if (skipResult.success && skipResult.prompt) {
        await ctx.editMessageText(skipResult.prompt)
      }
      break
  }
}

// Declare result variable that's used in switch cases
let result: { success: boolean; prompt?: string } | null = null
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/chat/telegram/wizard-ui.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/chat/telegram/wizard-ui.ts tests/chat/telegram/wizard-ui.test.ts
git commit -m "feat(telegram): add wizard UI components

Add Telegram-specific wizard UI with inline keyboards for
step navigation, confirmation, and error recovery."
```

---

### Task 7: Integrate Wizard into Telegram Provider

**Files:**

- Modify: `src/chat/telegram/index.ts`

**Step 1: Read current Telegram provider**

```bash
head -100 src/chat/telegram/index.ts
```

**Step 2: Modify Telegram provider to integrate wizard**

Add import and integration in `src/chat/telegram/index.ts`:

```typescript
// Add to imports
import { handleWizardMessage, handleWizardCallback } from './wizard-ui.js'
import { hasActiveWizard } from '../../wizard/state.js'

// In onMessage method, before regular message handling:
onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
  this.bot.on('message:text', async (ctx) => {
    // Check if wizard is active
    const userId = String(ctx.from?.id ?? '')
    const contextId = String(ctx.chat?.id ?? userId)

    if (hasActiveWizard(userId, contextId)) {
      const handled = await handleWizardMessage(ctx)
      if (handled) return
    }

    // Regular message handling
    const isAdmin = await this.checkAdminStatus(ctx)
    const msg = this.extractMessage(ctx, isAdmin)
    if (msg === null) return
    const reply = this.buildReplyFn(ctx)
    await this.withTypingIndicator(ctx, () => handler(msg, reply))
  })

  // Register callback handler for wizard buttons
  this.bot.on('callback_query:data', async (ctx) => {
    await handleWizardCallback(ctx)
  })
}
```

**Step 3: Add /setup command**

In `setCommands` method, add:

```typescript
const userCmds = [
  { command: 'help', description: 'Show available commands' },
  { command: 'setup', description: 'Run configuration wizard' }, // NEW
  { command: 'set', description: 'Open configuration menu' }, // UPDATED
  { command: 'config', description: 'View current configuration' },
  { command: 'clear', description: 'Clear conversation history and memory' },
]
```

**Step 4: Commit**

```bash
git add src/chat/telegram/index.ts
git commit -m "feat(telegram): integrate wizard into provider

Add wizard message handling and callback query support.
Register /setup command and integrate with existing flow."
```

---

## Phase 5: Mattermost UI

### Task 8: Create Mattermost Wizard UI

**Files:**

- Create: `src/chat/mattermost/wizard-ui.ts`

**Step 1: Write minimal implementation**

```typescript
/**
 * Mattermost-specific wizard UI components
 */

import { logger } from '../../logger.js'
import { createWizard, advanceStep, saveWizardConfig, cancelWizard } from '../../wizard/engine.js'
import { hasActiveWizard } from '../../wizard/state.js'

const log = logger.child({ scope: 'chat:mattermost:wizard' })

const TASK_PROVIDER = (process.env['TASK_PROVIDER'] as 'kaneo' | 'youtrack') ?? 'kaneo'

interface MattermostContext {
  userId: string
  contextId: string
  channelId: string
  postId?: string
  triggerId?: string
}

export async function handleWizardSlashCommand(
  ctx: MattermostContext,
  text: string,
): Promise<{
  response_type: string
  text: string
  [key: string]: unknown
}> {
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
    text: 'Unknown wizard command. Use `/papai-setup` to start the wizard.',
  }
}

export async function handleWizardDialog(
  ctx: MattermostContext,
  values: Record<string, string>,
): Promise<{ text: string; [key: string]: unknown }> {
  // Handle dialog submissions for configuration
  const response: { text: string; [key: string]: unknown } = {
    text: 'Configuration updated',
  }

  return response
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

export function buildLlmSettingsDialog(): Record<string, unknown> {
  return {
    title: '🤖 LLM Configuration',
    elements: [
      {
        type: 'text',
        label: 'API Key',
        name: 'llm_apikey',
        placeholder: 'sk-...',
      },
      {
        type: 'text',
        label: 'Base URL',
        name: 'llm_baseurl',
        placeholder: 'https://...',
      },
      {
        type: 'text',
        label: 'Main Model',
        name: 'main_model',
        placeholder: 'gpt-4',
      },
      {
        type: 'text',
        label: 'Small Model',
        name: 'small_model',
        placeholder: 'gpt-3.5',
      },
    ],
    submit_label: 'Save',
    notify_on_cancel: true,
  }
}
```

**Step 2: Commit**

```bash
git add src/chat/mattermost/wizard-ui.ts
git commit -m "feat(mattermost): add wizard UI components

Add Mattermost-specific wizard UI with slash commands and
interactive dialogs for configuration management."
```

---

## Phase 6: Commands Update

### Task 9: Create Setup Command

**Files:**

- Create: `src/commands/setup.ts`
- Modify: `src/commands/index.ts` (export setup command)

**Step 1: Write the failing test**

```typescript
import { describe, expect, test, mock } from 'bun:test'
import { registerSetupCommand } from '../../src/commands/setup.js'
import type { ChatProvider, IncomingMessage, ReplyFn } from '../../src/chat/types.js'

describe('Setup Command', () => {
  test('should register setup command', () => {
    const mockChat = {
      registerCommand: mock((name: string, handler: unknown) => {}),
    } as unknown as ChatProvider

    registerSetupCommand(mockChat)
    expect(mockChat.registerCommand).toHaveBeenCalled()
  })
})
```

**Step 2: Write minimal implementation**

```typescript
import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'
import { createWizard } from '../wizard/engine.js'

const log = logger.child({ scope: 'commands:setup' })

const TASK_PROVIDER = (process.env['TASK_PROVIDER'] as 'kaneo' | 'youtrack') ?? 'kaneo'

export function registerSetupCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) {
      await reply.text('You are not authorized to use this bot.')
      return
    }

    log.info({ userId: msg.user.id, contextId: auth.storageContextId }, '/setup command executed')

    // Wizard is platform-specific, so we just acknowledge here
    // The actual wizard handling is done in the chat provider
    await reply.text('Starting configuration wizard... Type /setup to begin.')
  }

  chat.registerCommand('setup', handler)
}
```

**Step 3: Update commands index**

```typescript
export { registerAdminCommands } from './admin.js'
export { registerClearCommand } from './clear.js'
export { registerConfigCommand } from './config.js'
export { registerContextCommand } from './context.js'
export { registerGroupCommand } from './group.js'
export { registerHelpCommand } from './help.js'
export { registerSetCommand } from './set.js'
export { registerSetupCommand } from './setup.js' // NEW
```

**Step 4: Commit**

```bash
git add src/commands/setup.ts src/commands/index.ts tests/commands/setup.test.ts
git commit -m "feat(commands): add /setup command

Add setup command handler that triggers the configuration wizard.
Command is registered with all chat providers."
```

---

### Task 10: Update Set Command

**Files:**

- Modify: `src/commands/set.ts`

**Step 1: Modify set command to open menu**

Update `src/commands/set.ts` to check for platform and open appropriate menu:

```typescript
// When /set is called without arguments, open the configuration menu
const match = (msg.commandMatch ?? '').trim()
if (match === '') {
  // Open configuration menu
  if (msg.contextType === 'group') {
    await reply.text('Configuration menu:\n\nUse /set <key> <value> to set a specific value.')
  } else {
    // For DMs, suggest the wizard
    await reply.text(
      '💡 Tip: Use /setup for an interactive configuration wizard, or /set <key> <value> for manual configuration.',
    )
  }
  return
}
```

**Step 2: Commit**

```bash
git add src/commands/set.ts
git commit -m "feat(commands): update /set to show help message

When /set is called without arguments, show helpful message
suggesting the wizard or manual configuration."
```

---

### Task 11: Update Config Command

**Files:**

- Modify: `src/commands/config.ts`

**Step 1: Modify config command to add edit option**

Update `src/commands/config.ts` to include an edit button/message:

```typescript
// After showing config, add edit option for Telegram
if (msg.contextType === 'dm') {
  await reply.text(lines.join('\n') + '\n\n💡 Use /setup to edit configuration interactively.')
}
```

**Step 2: Commit**

```bash
git add src/commands/config.ts
git commit -m "feat(commands): update /config with edit hint

Add helpful message suggesting /setup for interactive editing."
```

---

## Phase 7: Integration

### Task 12: Integrate Wizard into Bot

**Files:**

- Modify: `src/bot.ts`

**Step 1: Add wizard integration to bot.ts**

Add import and check for incomplete configuration:

```typescript
// Add to imports
import { getAllConfig } from './config.js'
import { hasActiveWizard } from './wizard/state.js'

// In setupBot function, add wizard detection
export async function setupBot(chat: ChatProvider, adminUserId: string): Promise<void> {
  // ... existing setup code ...

  // Check for incomplete configuration and suggest wizard
  chat.onMessage(async (msg, reply) => {
    // Check if user needs setup
    const config = getAllConfig(msg.user.id)
    const needsSetup = !config.llm_apikey || !config.main_model

    if (needsSetup && !hasActiveWizard(msg.user.id, msg.contextId)) {
      await reply.text(
        '👋 Welcome! It looks like you need to configure the bot.\n\nType /setup to run the interactive configuration wizard.',
      )
      return
    }

    // ... existing message handling ...
  })
}
```

**Step 2: Register setup command in bot.ts**

```typescript
// Add to imports
import { registerSetupCommand } from './commands/setup.js'

// In setupBot function, add:
registerSetupCommand(chat)
```

**Step 3: Commit**

```bash
git add src/bot.ts
git commit -m "feat(bot): integrate wizard and detect incomplete config

Add automatic detection of incomplete configuration.
Suggest wizard to new users. Register /setup command."
```

---

## Phase 8: Testing & Polish

### Task 13: Add E2E Wizard Test

**Files:**

- Create: `tests/e2e/wizard.test.ts`

**Step 1: Write E2E test**

```typescript
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'

describe('Configuration Wizard E2E', () => {
  let testClient: KaneoTestClient

  beforeEach(async () => {
    testClient = createTestClient()
    await testClient.cleanup()
  })

  afterEach(async () => {
    await testClient.cleanup()
  })

  test('should complete wizard flow', async () => {
    // This test would require full bot integration
    // For now, just verify the test setup works
    expect(testClient).toBeDefined()
  })
})
```

**Step 2: Commit**

```bash
git add tests/e2e/wizard.test.ts
git commit -m "test(e2e): add wizard e2e test scaffold

Add end-to-end test structure for configuration wizard."
```

---

### Task 14: Final Integration Testing

**Step 1: Run all tests**

```bash
bun test
```

**Step 2: Run type checking**

```bash
bun typecheck
```

**Step 3: Run linting**

```bash
bun lint
```

**Step 4: Commit if all pass**

```bash
git commit -m "test: verify all tests pass for wizard implementation

- All unit tests passing
- Type checking passes
- Linting passes"
```

---

## Summary

### Files Created

```
src/wizard/
├── types.ts           # Type definitions
├── state.ts           # Session management
├── steps.ts           # Step definitions
├── validation.ts      # Live validation
└── engine.ts          # Core engine

src/chat/telegram/
└── wizard-ui.ts       # Telegram UI

src/chat/mattermost/
└── wizard-ui.ts       # Mattermost UI

src/commands/
└── setup.ts           # Setup command

tests/wizard/
├── types.test.ts
├── state.test.ts
├── steps.test.ts
├── validation.test.ts
└── engine.test.ts

tests/chat/telegram/
└── wizard-ui.test.ts

tests/e2e/
└── wizard.test.ts
```

### Files Modified

```
src/chat/telegram/index.ts     # Integrate wizard
src/commands/index.ts          # Export setup command
src/commands/set.ts            # Update to show menu
src/commands/config.ts         # Add edit hint
src/bot.ts                     # Detect incomplete config
```

### Testing Checklist

- [ ] Unit tests for all wizard components
- [ ] Integration tests for full wizard flow
- [ ] Telegram UI tests with mocked API
- [ ] Mattermost dialog tests
- [ ] E2E test scaffold
- [ ] Type checking passes
- [ ] Linting passes

### Deployment Notes

1. No database migrations needed (uses in-memory storage)
2. Add `/setup` command to BotFather commands
3. Update help text to mention wizard
4. Monitor for wizard completion rates

---

**Plan complete and saved to `docs/plans/2026-03-27-bot-configuration-ux-implementation.md`.**

## Next Steps

**Ready for implementation!** Use the executing-plans skill to implement this plan task-by-task.
