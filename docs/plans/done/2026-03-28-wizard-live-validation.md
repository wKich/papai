# Wizard Live Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time validation to the configuration wizard that tests API keys, URLs, and models against actual LLM endpoints before saving.

**Architecture:** Create a validation service (`src/wizard/validation.ts`) that makes real HTTP requests to verify connectivity. Each wizard step will have an optional `liveCheck` function that performs async validation. Results are shown to users immediately with helpful error messages.

**Tech Stack:** TypeScript, native `fetch()`, Zod (schema validation), existing test helpers

**Reference:** @docs/plans/2026-03-27-bot-configuration-ux-implementation.md Phase 2

---

## Pre-Implementation Checklist

Before starting, read these files to understand the codebase:

- [ ] Read `src/wizard/types.ts` - Understand WizardStep interface and liveCheck signature
- [ ] Read `src/wizard/steps.ts` - See how steps are created and validation works
- [ ] Read `src/wizard/engine.ts` - See how liveCheck is called in validateAndStoreValue()
- [ ] Read `tests/wizard/engine.test.ts` - See existing wizard engine tests
- [ ] Read `tests/wizard/steps.test.ts` - See existing wizard test patterns
- [ ] Read `tests/utils/test-helpers.ts` - See mocking patterns (createLoggerMock, mock)

---

## Phase 1: Core Validation Service

### Task 1: Create Validation Types

**Files:**

- Create: `src/wizard/validation.ts`
- Test: `tests/wizard/validation.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  validateLlmApiKey,
  validateLlmBaseUrl,
  validateModelExists,
  type ValidationResult,
} from '../../src/wizard/validation.js'

describe('validateLlmApiKey', () => {
  test('should return success for valid API key', async () => {
    const result = await validateLlmApiKey('sk-test', 'https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/validation.test.ts
```

Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `src/wizard/validation.ts`:

```typescript
/**
 * Live validation service for wizard configuration
 * Makes real HTTP requests to verify connectivity
 */

import { logger } from '../logger.js'

const log = logger.child({ scope: 'wizard:validation' })

export interface ValidationResult {
  readonly success: boolean
  readonly message?: string
}

export async function validateLlmApiKey(apiKey: string, baseUrl: string): Promise<ValidationResult> {
  log.debug({ baseUrl }, 'Validating LLM API key')
  return { success: true }
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
git commit -m "feat(wizard): add validation service skeleton

Add validateLlmApiKey function with basic structure and types."
```

---

### Task 2: Test API Key Validation with Mocked Fetch

**Files:**

- Modify: `src/wizard/validation.ts`
- Test: `tests/wizard/validation.test.ts`

**Step 1: Write the failing test**

Add to `tests/wizard/validation.test.ts`:

```typescript
describe('validateLlmApiKey with mocked fetch', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('should succeed when API returns 200', async () => {
    globalThis.fetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ id: 'gpt-4' }] }),
      } as Response)

    const result = await validateLlmApiKey('sk-valid', 'https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })

  test('should fail when API returns 401', async () => {
    globalThis.fetch = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response)

    const result = await validateLlmApiKey('sk-invalid', 'https://api.openai.com/v1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('Invalid API key')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/validation.test.ts
```

Expected: FAIL - tests for 401 handling don't pass yet

**Step 3: Write minimal implementation**

Update `src/wizard/validation.ts`:

```typescript
export async function validateLlmApiKey(apiKey: string, baseUrl: string): Promise<ValidationResult> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (response.status === 401) {
      return { success: false, message: '❌ Invalid API key. Please check and try again.' }
    }

    if (!response.ok) {
      return { success: false, message: `❌ API error: ${response.status} ${response.statusText}` }
    }

    return { success: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'API key validation failed')
    return { success: false, message: '❌ Connection failed. Please check your internet connection.' }
  }
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
git commit -m "feat(wizard): implement API key validation

Add real HTTP validation against /models endpoint. Returns user-friendly
error messages for 401 and connection failures."
```

---

### Task 3: Add Base URL Validation

**Files:**

- Modify: `src/wizard/validation.ts`
- Test: `tests/wizard/validation.test.ts`

**Step 1: Write the failing test**

Add to `tests/wizard/validation.test.ts`:

```typescript
describe('validateLlmBaseUrl', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('should succeed when URL is reachable', async () => {
    globalThis.fetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
      } as Response)

    const result = await validateLlmBaseUrl('https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })

  test('should fail when URL is unreachable', async () => {
    globalThis.fetch = () => Promise.reject(new Error('Connection refused'))

    const result = await validateLlmBaseUrl('http://localhost:99999')
    expect(result.success).toBe(false)
    expect(result.message).toContain('Cannot connect')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/validation.test.ts
```

Expected: FAIL - validateLlmBaseUrl not defined

**Step 3: Write minimal implementation**

Add to `src/wizard/validation.ts`:

```typescript
export async function validateLlmBaseUrl(baseUrl: string): Promise<ValidationResult> {
  try {
    const response = await fetch(baseUrl, { method: 'HEAD' })
    if (!response.ok && response.status !== 404) {
      return { success: false, message: `❌ Server returned error: ${response.status}` }
    }
    return { success: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Base URL validation failed')
    return { success: false, message: '❌ Cannot connect to the provided URL. Please check and try again.' }
  }
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
git commit -m "feat(wizard): add base URL validation

Add HEAD request validation for custom base URLs. Returns user-friendly
error messages for connection failures."
```

---

### Task 4: Add Model Existence Validation

**Files:**

- Modify: `src/wizard/validation.ts`
- Test: `tests/wizard/validation.test.ts`

**Step 1: Write the failing test**

Add to `tests/wizard/validation.test.ts`:

```typescript
describe('validateModelExists', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('should succeed when model exists', async () => {
    globalThis.fetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }] }),
      } as Response)

    const result = await validateModelExists('gpt-4', 'sk-test', 'https://api.openai.com/v1')
    expect(result.success).toBe(true)
  })

  test('should fail when model does not exist', async () => {
    globalThis.fetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ id: 'gpt-4' }] }),
      } as Response)

    const result = await validateModelExists('nonexistent-model', 'sk-test', 'https://api.openai.com/v1')
    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/validation.test.ts
```

Expected: FAIL - validateModelExists not defined

**Step 3: Write minimal implementation**

Add to `src/wizard/validation.ts`:

```typescript
export async function validateModelExists(
  modelName: string,
  apiKey: string,
  baseUrl: string,
): Promise<ValidationResult> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      return { success: false, message: '❌ Could not fetch model list' }
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
        success: false,
        message: `❌ Model '${modelName}' not found. Some available models: ${suggestions}...`,
      }
    }

    return { success: true }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Model validation failed')
    return { success: false, message: '❌ Could not verify model. Please try again.' }
  }
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
git commit -m "feat(wizard): add model existence validation

Validates that specified model exists in the API's model list.
Provides helpful suggestions when model is not found."
```

---

## Phase 2: Update Wizard Types and Steps

### Task 5: Update WizardStep Type for Async Live Validation

**Files:**

- Modify: `src/wizard/types.ts`
- Modify: `src/wizard/steps.ts` (fix existing liveCheck if any)
- Test: `tests/wizard/types.test.ts`

**Step 1: Write the failing test**

Update `tests/wizard/types.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import type { WizardStep } from '../../src/wizard/types.js'

describe('WizardStep type', () => {
  test('should accept step with async liveCheck function', () => {
    const step: WizardStep = {
      id: 'test',
      key: 'llm_apikey',
      prompt: 'Enter API key:',
      validate: async () => null,
      liveCheck: async (value: string) => ({ success: true }),
    }

    expect(step.id).toBe('test')
    expect(typeof step.liveCheck).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/types.test.ts
```

Expected: FAIL - Type error if liveCheck signature doesn't match (expects boolean return, gets Promise)

**Step 3: Write minimal implementation**

Update `src/wizard/types.ts`:

```typescript
import type { ValidationResult } from './validation.js'

// ... existing types ...

export interface WizardStep {
  id: string
  key: ConfigKey
  prompt: string
  validate: (value: string) => Promise<string | null>
  liveCheck?: (value: string) => Promise<ValidationResult>
  isOptional?: boolean
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
git commit -m "feat(wizard): update WizardStep type for async live validation

Change liveCheck signature to return Promise<ValidationResult>
for async validation support."
```

---

### Task 6: Export Validation Service

**Files:**

- Modify: `src/wizard/index.ts`

**Step 1: Add exports to wizard index**

Update `src/wizard/index.ts`:

```typescript
export { hasActiveWizard } from './state.js'
export { processWizardMessage, createWizard } from './engine.js'
export type { WizardProcessResult } from './types.js'
export { validateLlmApiKey, validateLlmBaseUrl, validateModelExists, type ValidationResult } from './validation.js'
```

**Step 2: Verify TypeScript compiles**

```bash
bun typecheck
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/wizard/index.ts
git commit -m "feat(wizard): export validation service from index

Export validation functions and ValidationResult type for use in steps."
```

---

### Task 7: Add Live Validation to API Key Step

**Files:**

- Modify: `src/wizard/steps.ts`
- Test: `tests/wizard/steps.test.ts`

**Step 1: Write the failing test**

Update `tests/wizard/steps.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { getWizardSteps } from '../../src/wizard/steps.js'

describe('Wizard steps live validation', () => {
  test('llm_apikey step should have liveCheck function', () => {
    const steps = getWizardSteps('kaneo')
    const apiKeyStep = steps.find((s) => s.key === 'llm_apikey')

    expect(apiKeyStep).toBeDefined()
    expect(apiKeyStep?.liveCheck).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/steps.test.ts
```

Expected: FAIL - liveCheck not yet added

**Step 3: Write minimal implementation**

Update `src/wizard/steps.ts`:

```typescript
import { normalizeTimezone } from '../utils/timezone.js'
import type { WizardStep } from './types.js'
import { validateLlmApiKey } from './validation.js'

// ... existing types and constants ...

function createStep(
  id: string,
  key: WizardStep['key'],
  prompt: string,
  isOptional?: boolean,
  liveCheck?: WizardStep['liveCheck'],
): WizardStep {
  return {
    id,
    key,
    prompt,
    validate: (value: string) => Promise.resolve(validateStep(key, value)),
    liveCheck,
    isOptional,
  }
}

export function getWizardSteps(taskProvider: TaskProvider): WizardStep[] {
  const providerStep = PROVIDER_SPECIFIC_STEP[taskProvider]

  return [
    createStep('llm_apikey', 'llm_apikey', '🔑 Enter your LLM API key:', undefined, async (value: string) =>
      validateLlmApiKey(value, 'https://api.openai.com/v1'),
    ),
    // ... rest of steps remain unchanged for now
    createStep('llm_baseurl', 'llm_baseurl', "🌐 Enter base URL (or 'default' for OpenAI):"),
    createStep('main_model', 'main_model', '🤖 Enter main model name (e.g., gpt-4, claude-3-opus):'),
    createStep('small_model', 'small_model', "⚡ Enter small model name (or 'same' to use main model):"),
    createStep('embedding_model', 'embedding_model', "📊 Enter embedding model (or 'skip' to use default):", true),
    createStep(providerStep.key, providerStep.key, providerStep.prompt),
    createStep('timezone', 'timezone', '🌍 Enter your timezone (e.g., America/New_York, UTC, UTC+5):'),
  ]
}

// ... rest of file unchanged ...
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/wizard/steps.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/wizard/steps.ts tests/wizard/steps.test.ts
git commit -m "feat(wizard): add live validation to API key step

API key step now validates against real LLM endpoint before proceeding.
Uses validateLlmApiKey from validation service."
```

---

### Task 8: Add Live Validation to Base URL Step

**Files:**

- Modify: `src/wizard/steps.ts`
- Test: `tests/wizard/steps.test.ts`

**Step 1: Write the failing test**

Add to `tests/wizard/steps.test.ts`:

```typescript
describe('Base URL step live validation', () => {
  test('llm_baseurl step should have liveCheck function', () => {
    const steps = getWizardSteps('kaneo')
    const baseUrlStep = steps.find((s) => s.key === 'llm_baseurl')

    expect(baseUrlStep).toBeDefined()
    expect(baseUrlStep?.liveCheck).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/steps.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

Update `src/wizard/steps.ts`:

```typescript
import { validateLlmApiKey, validateLlmBaseUrl } from './validation.js'

// ... in getWizardSteps function:
    createStep(
      'llm_baseurl',
      'llm_baseurl',
      "🌐 Enter base URL (or 'default' for OpenAI):",
      undefined,
      async (value: string) => {
        // Skip validation for 'default' keyword
        if (value.trim().toLowerCase() === 'default') {
          return { success: true }
        }
        return validateLlmBaseUrl(value)
      },
    ),
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/wizard/steps.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/wizard/steps.ts tests/wizard/steps.test.ts
git commit -m "feat(wizard): add live validation to base URL step

Base URL step now validates connectivity before proceeding.
Uses validateLlmBaseUrl from validation service."
```

---

### Task 9: Add Live Validation to Model Steps

**Files:**

- Modify: `src/wizard/steps.ts`
- Modify: `src/wizard/validation.ts` (add helper for model validation)
- Test: `tests/wizard/steps.test.ts`

**Step 1: Write the failing test**

Add to `tests/wizard/steps.test.ts`:

```typescript
describe('Model steps live validation', () => {
  test('main_model step should have liveCheck function', () => {
    const steps = getWizardSteps('kaneo')
    const modelStep = steps.find((s) => s.key === 'main_model')

    expect(modelStep).toBeDefined()
    expect(modelStep?.liveCheck).toBeDefined()
  })

  test('small_model step should have liveCheck function', () => {
    const steps = getWizardSteps('kaneo')
    const modelStep = steps.find((s) => s.key === 'small_model')

    expect(modelStep).toBeDefined()
    expect(modelStep?.liveCheck).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/steps.test.ts
```

Expected: FAIL

**Step 3: Write minimal implementation**

First, add helper to `src/wizard/validation.ts`:

```typescript
/**
 * Create a model validator that uses provided API credentials
 * Note: This is a factory that creates a closure over the credentials
 */
export function createModelValidator(
  apiKey: string,
  baseUrl: string,
): (modelName: string) => Promise<ValidationResult> {
  return async (modelName: string): Promise<ValidationResult> => {
    if (modelName === 'same') {
      return { success: true }
    }
    return validateModelExists(modelName, apiKey, baseUrl)
  }
}
```

Then update `src/wizard/steps.ts`:

```typescript
import { validateLlmApiKey, validateLlmBaseUrl, createModelValidator } from './validation.js'

// ... update getWizardSteps to accept optional context parameter:
export function getWizardSteps(
  taskProvider: TaskProvider,
  context?: { apiKey?: string; baseUrl?: string },
): WizardStep[] {
  const providerStep = PROVIDER_SPECIFIC_STEP[taskProvider]

  // Get base URL, defaulting to OpenAI if not provided or 'default'
  const effectiveBaseUrl =
    context?.baseUrl && context.baseUrl !== 'default' ? context.baseUrl : 'https://api.openai.com/v1'

  // Create model validator if we have API key
  const modelValidator = context?.apiKey ? createModelValidator(context.apiKey, effectiveBaseUrl) : undefined

  return [
    createStep('llm_apikey', 'llm_apikey', '🔑 Enter your LLM API key:', undefined, async (value: string) =>
      validateLlmApiKey(value, 'https://api.openai.com/v1'),
    ),
    createStep(
      'llm_baseurl',
      'llm_baseurl',
      "🌐 Enter base URL (or 'default' for OpenAI):",
      undefined,
      async (value: string) => {
        if (value.trim().toLowerCase() === 'default') {
          return { success: true }
        }
        return validateLlmBaseUrl(value)
      },
    ),
    createStep(
      'main_model',
      'main_model',
      '🤖 Enter main model name (e.g., gpt-4, claude-3-opus):',
      undefined,
      modelValidator,
    ),
    createStep(
      'small_model',
      'small_model',
      "⚡ Enter small model name (or 'same' to use main model):",
      undefined,
      modelValidator,
    ),
    // ... rest unchanged
    createStep('embedding_model', 'embedding_model', "📊 Enter embedding model (or 'skip' to use default):", true),
    createStep(providerStep.key, providerStep.key, providerStep.prompt),
    createStep('timezone', 'timezone', '🌍 Enter your timezone (e.g., America/New_York, UTC, UTC+5):'),
  ]
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/wizard/steps.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/wizard/steps.ts src/wizard/validation.ts tests/wizard/steps.test.ts
git commit -m "feat(wizard): add live validation to model steps

Model steps now validate that the specified model exists in the API.
Uses createModelValidator to validate with previously entered credentials.
getWizardSteps now accepts optional context parameter with apiKey and baseUrl."
```

---

## Phase 3: Integration with Wizard Engine

### Task 10: Update Engine to Pass Context to Steps

**Files:**

- Modify: `src/wizard/engine.ts`
- Test: `tests/wizard/engine.test.ts`

**Step 1: Write the failing test**

Add to `tests/wizard/engine.test.ts`:

```typescript
describe('Wizard engine with live validation', () => {
  const userId = 'test-user-live'
  const storageContextId = 'test-context-live'

  beforeEach(async () => {
    await deleteWizardSession(userId, storageContextId)
  })

  test('should validate API key during step advancement', async () => {
    // Mock fetch to simulate API key validation
    const originalFetch = globalThis.fetch
    globalThis.fetch = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response)

    try {
      createWizard(userId, storageContextId, 'telegram', 'kaneo')

      const result = await advanceStep(userId, storageContextId, 'invalid-key', false)
      expect(result.success).toBe(false)
      expect(result.prompt).toContain('Invalid API key')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/wizard/engine.test.ts
```

Expected: FAIL - engine needs to be updated to pass context to steps and await liveCheck

**Step 3: Write minimal implementation**

Update `src/wizard/engine.ts`:

```typescript
// Update validateAndStoreValue to await liveCheck:
async function validateAndStoreValue(
  currentStep: NonNullable<ReturnType<typeof getStepByIndex>>,
  value: string,
  skipValidation: boolean,
): Promise<string | null> {
  if (skipValidation) return null

  const validationError = await currentStep.validate(value)
  if (validationError !== null) {
    return `❌ ${validationError}\n\n${currentStep.prompt}\n\nPlease try again:`
  }

  if (currentStep.liveCheck !== undefined) {
    const liveResult = await currentStep.liveCheck(value)
    if (!liveResult.success) {
      return `${liveResult.message}\n\n${currentStep.prompt}\n\nPlease try again:`
    }
  }

  return null
}

// Update completeStep to capture values for next step validation:
function completeStep(
  userId: string,
  storageContextId: string,
  currentStep: NonNullable<ReturnType<typeof getStepByIndex>>,
  value: string,
  session: NonNullable<ReturnType<typeof getWizardSession>>,
): AdvanceStepResult {
  const normalizedValue = normalizeValue(currentStep.key, value, session.data)
  const dataUpdate: Partial<Record<ConfigKey, string>> = {}
  if (normalizedValue !== '') {
    dataUpdate[currentStep.key] = normalizedValue
  }

  updateWizardSession(userId, storageContextId, {
    currentStep: session.currentStep + 1,
    data: dataUpdate,
  })

  logger.info({ userId, storageContextId, stepIndex: session.currentStep, key: currentStep.key }, 'Step completed')

  const updatedSession = getWizardSession(userId, storageContextId)
  if (updatedSession === null) return { success: false, prompt: 'Error: Session lost' }

  if (updatedSession.currentStep >= updatedSession.totalSteps) {
    return { success: true, prompt: showSummary(userId, storageContextId), complete: true }
  }

  return { success: true, prompt: getNextPrompt(userId, storageContextId) }
}

// Update getNextPrompt to pass context to getStepByIndex:
function getNextPrompt(userId: string, storageContextId: string): string {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) return 'Error: Wizard session not found'

  const step = getStepByIndex(session.taskProvider, session.currentStep, session.data)
  if (step === undefined) return 'Error: Invalid step index'

  return step.prompt
}
```

Now update `src/wizard/steps.ts` to update getStepByIndex:

```typescript
export function getStepByIndex(
  taskProvider: TaskProvider,
  index: number,
  context?: { apiKey?: string; baseUrl?: string },
): WizardStep | undefined {
  const steps = getWizardSteps(taskProvider, context)
  return steps[index]
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/wizard/engine.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/wizard/engine.ts src/wizard/steps.ts tests/wizard/engine.test.ts
git commit -m "feat(wizard): integrate live validation into engine

Engine now passes session data context to steps for credential access.
Live validation is awaited during step advancement and shows
user-friendly error messages on failure."
```

---

## Phase 4: Final Verification

### Task 11: Run All Tests

**Step 1: Run wizard tests**

```bash
bun test tests/wizard/
```

Expected: ALL PASS (existing tests + new validation tests)

**Step 2: Run full test suite**

```bash
bun test
```

Expected: ALL PASS

**Step 3: Type check**

```bash
bun typecheck
```

Expected: No errors

**Step 4: Lint**

```bash
bun lint
```

Expected: No errors

**Step 5: Commit final changes**

```bash
git commit -m "chore(wizard): final verification of live validation

All tests passing:
- API key validation with real HTTP calls
- Base URL connectivity checks
- Model existence verification
- Integration with wizard engine

Ready for use in configuration wizard."
```

---

## Summary

### What Was Built

1. **Validation Service** (`src/wizard/validation.ts`)
   - `validateLlmApiKey()` - Tests API key against /models endpoint
   - `validateLlmBaseUrl()` - Tests URL connectivity
   - `validateModelExists()` - Verifies model in API model list
   - `createModelValidator()` - Factory for validators with credentials

2. **Updated Types** (`src/wizard/types.ts`)
   - `WizardStep.liveCheck` now async with `ValidationResult`

3. **Updated Steps** (`src/wizard/steps.ts`)
   - API key step validates credentials
   - Base URL step tests connectivity
   - Model steps verify model existence
   - `getWizardSteps()` accepts optional context with credentials
   - `getStepByIndex()` accepts context parameter

4. **Updated Engine** (`src/wizard/engine.ts`)
   - Passes session data context to steps
   - Awaits live validation during step advancement
   - Shows user-friendly error messages

5. **Updated Index** (`src/wizard/index.ts`)
   - Exports validation functions for external use

### Testing Coverage

- Unit tests for all validation functions
- Mocked fetch for reliable test execution
- Integration tests for engine validation flow
- All existing tests still pass

### User Experience

Users now get real-time feedback:

- "❌ Invalid API key. Please check and try again."
- "❌ Cannot connect to the provided URL."
- "❌ Model 'xyz' not found. Some available models: gpt-4, gpt-3.5-turbo..."

This prevents saving invalid configuration and guides users to correct issues immediately.

### API Changes

- `getWizardSteps(taskProvider, context?)` - Now accepts optional context
- `getStepByIndex(taskProvider, index, context?)` - Now accepts optional context
- `WizardStep.liveCheck` - Changed from `(value: string) => boolean` to `(value: string) => Promise<ValidationResult>`

### Backward Compatibility

- `getWizardSteps()` without context parameter still works (defaults to no live validation for model steps)
- Existing code using `getStepByIndex(taskProvider, index)` continues to work
