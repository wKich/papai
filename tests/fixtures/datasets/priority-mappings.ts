/**
 * Priority Mapping Between Linear and Plane
 * 
 * Linear: 0-4 (numeric)
 * Plane: 'none', 'urgent', 'high', 'medium', 'low' (string enum)
 */

export const LINEAR_TO_PLANE_PRIORITY: Record<number, string> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
}

export const PLANE_TO_LINEAR_PRIORITY: Record<string, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
}

export const VALID_LINEAR_PRIORITIES = [0, 1, 2, 3, 4] as const
export const VALID_PLANE_PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'] as const

export type LinearPriority = typeof VALID_LINEAR_PRIORITIES[number]
export type PlanePriority = typeof VALID_PLANE_PRIORITIES[number]

/**
 * Convert Linear priority to Plane priority
 */
export function linearPriorityToPlane(priority: number | null | undefined): PlanePriority | null {
  if (priority === null || priority === undefined) return null
  const mapped = LINEAR_TO_PLANE_PRIORITY[priority]
  if (!mapped) return null
  return mapped as PlanePriority
}

/**
 * Convert Plane priority to Linear priority
 */
export function planePriorityToLinear(priority: string | null | undefined): LinearPriority | null {
  if (priority === null || priority === undefined) return null
  const mapped = PLANE_TO_LINEAR_PRIORITY[priority]
  if (mapped === undefined) return null
  return mapped as LinearPriority
}

/**
 * Validate Linear priority
 */
export function isValidLinearPriority(priority: number): boolean {
  return VALID_LINEAR_PRIORITIES.includes(priority as LinearPriority)
}

/**
 * Validate Plane priority
 */
export function isValidPlanePriority(priority: string): boolean {
  return VALID_PLANE_PRIORITIES.includes(priority as PlanePriority)
}
