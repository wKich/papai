/**
 * Test Utilities and Helpers
 * 
 * Shared utilities for test setup, assertions, and helpers
 */

import { expect } from 'bun:test'

/**
 * Wait for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delay?: number } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 100 } = options
  
  let lastError: Error | undefined
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (i < maxRetries - 1) {
        await sleep(delay * Math.pow(2, i))
      }
    }
  }
  
  throw lastError ?? new Error('Operation failed after retries')
}

/**
 * Generate a unique test identifier
 */
export function generateTestId(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Generate a random string
 */
export function generateRandomString(length: number = 10): string {
  return Math.random().toString(36).substring(2, 2 + length)
}

/**
 * Assert that an error matches expected properties
 */
export function expectError(
  error: unknown,
  expected: { code?: string; message?: string | RegExp; status?: number }
): void {
  if (!(error instanceof Error)) {
    throw new Error(`Expected Error but got ${typeof error}`)
  }
  
  if (expected.code !== undefined) {
    const errorCode = (error as any).code
    expect(errorCode).toBe(expected.code)
  }
  
  if (expected.message !== undefined) {
    if (expected.message instanceof RegExp) {
      expect(error.message).toMatch(expected.message)
    } else {
      expect(error.message).toContain(expected.message)
    }
  }
  
  if (expected.status !== undefined) {
    const errorStatus = (error as any).status
    expect(errorStatus).toBe(expected.status)
  }
}

/**
 * Assert that two dates are close (within tolerance)
 */
export function expectDatesClose(
  actual: string | Date,
  expected: string | Date,
  toleranceMs: number = 1000
): void {
  const actualDate = typeof actual === 'string' ? new Date(actual) : actual
  const expectedDate = typeof expected === 'string' ? new Date(expected) : expected
  const diff = Math.abs(actualDate.getTime() - expectedDate.getTime())
  expect(diff).toBeLessThanOrEqual(toleranceMs)
}

/**
 * Assert that an array has unique elements
 */
export function expectUnique<T>(array: T[]): void {
  expect(new Set(array).size).toBe(array.length)
}

/**
 * Assert that an object has required shape
 */
export function expectShape(
  obj: Record<string, unknown>,
  shape: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array' | 'undefined'>
): void {
  for (const [key, type] of Object.entries(shape)) {
    const value = obj[key]
    const actualType = Array.isArray(value) ? 'array' : typeof value
    expect(actualType).toBe(type)
  }
}

/**
 * Create a mock response delay
 */
export function mockDelay(ms: number = 100): Promise<void> {
  return sleep(ms)
}

/**
 * Parse ISO date string or return null
 */
export function parseDate(dateString: string | null | undefined): Date | null {
  if (!dateString) return null
  const date = new Date(dateString)
  return isNaN(date.getTime()) ? null : date
}

/**
 * Convert markdown to HTML (basic implementation)
 */
export function markdownToHtml(markdown: string): string {
  // Simple markdown to HTML conversion
  let html = markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Lists
    .replace(/^\* (.*$)/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // Code blocks
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hlu\/<])(.+)$/gim, '<p>$1</p>')
  
  return `<div>${html}</div>`
}

/**
 * Test context for e2e tests
 */
export interface TestContext {
  testId: string
  linearApiKey: string
  planeApiKey: string
  workspaceSlug: string
  projectId: string
  teamId: string
}

/**
 * Create a test context
 */
export function createTestContext(overrides: Partial<TestContext> = {}): TestContext {
  const testId = generateTestId()
  return {
    testId,
    linearApiKey: `linear-${testId}`,
    planeApiKey: `plane-${testId}`,
    workspaceSlug: `workspace-${testId}`,
    projectId: `project-${testId}`,
    teamId: `team-${testId}`,
    ...overrides,
  }
}

/**
 * Type guard for checking if value is defined
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

/**
 * Filter out undefined/null values from object
 */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => isDefined(v))
  ) as Partial<T>
}
