/**
 * Test Configuration
 *
 * Shared configuration and utilities for all tests
 */

/**
 * Test configuration loaded from environment variables
 */
export const TEST_CONFIG = {
  plane: {
    apiKey: process.env['PLANE_TEST_API_KEY'] ?? '',
    workspaceSlug: process.env['PLANE_TEST_WORKSPACE'] ?? '',
    projectId: process.env['PLANE_TEST_PROJECT_ID'] ?? '',
    baseUrl: process.env['PLANE_TEST_URL'] ?? 'https://api.plane.so',
  },
  linear: {
    apiKey: process.env['LINEAR_TEST_API_KEY'] ?? '',
    teamId: process.env['LINEAR_TEST_TEAM_ID'] ?? '',
  },
}

/**
 * Check if Plane API configuration is available
 */
export function hasPlaneConfig(): boolean {
  return Boolean(TEST_CONFIG.plane.apiKey && TEST_CONFIG.plane.workspaceSlug)
}

/**
 * Check if Linear API configuration is available
 */
export function hasLinearConfig(): boolean {
  return Boolean(TEST_CONFIG.linear.apiKey && TEST_CONFIG.linear.teamId)
}

/**
 * Skip test if Plane API not configured
 */
export function skipIfNoPlaneApi(): void {
  if (!hasPlaneConfig()) {
    throw new Error('Plane API not configured. Set PLANE_TEST_API_KEY and PLANE_TEST_WORKSPACE environment variables.')
  }
}

/**
 * Skip test if Linear API not configured
 */
export function skipIfNoLinearApi(): void {
  if (!hasLinearConfig()) {
    throw new Error('Linear API not configured. Set LINEAR_TEST_API_KEY and LINEAR_TEST_TEAM_ID environment variables.')
  }
}

/**
 * Generate unique test identifier
 */
export function generateTestId(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}
