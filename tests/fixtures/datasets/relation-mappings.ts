/**
 * Relation Type Mappings Between Linear and Plane
 *
 * Linear: 'blocks' | 'blockedBy' | 'duplicate' | 'related'
 * Plane: 'blocking' | 'blocked_by' | 'duplicate' | 'relates_to' |
 *        'start_after' | 'start_before' | 'finish_after' | 'finish_before'
 */

export const LINEAR_TO_PLANE_RELATION: Record<string, string> = {
  blocks: 'blocking',
  blockedBy: 'blocked_by',
  duplicate: 'duplicate',
  related: 'relates_to',
}

export const PLANE_TO_LINEAR_RELATION: Record<string, string> = {
  blocking: 'blocks',
  blocked_by: 'blockedBy',
  duplicate: 'duplicate',
  relates_to: 'related',
}

// Plane has additional relation types not in Linear
export const PLANE_ONLY_RELATIONS = ['start_after', 'start_before', 'finish_after', 'finish_before'] as const

export const VALID_LINEAR_RELATIONS = ['blocks', 'blockedBy', 'duplicate', 'related'] as const
export const VALID_PLANE_RELATIONS = [
  'blocking',
  'blocked_by',
  'duplicate',
  'relates_to',
  ...PLANE_ONLY_RELATIONS,
] as const

export type LinearRelation = (typeof VALID_LINEAR_RELATIONS)[number]
export type PlaneRelation = (typeof VALID_PLANE_RELATIONS)[number]

/**
 * Convert Linear relation type to Plane
 */
export function linearRelationToPlane(relation: string): PlaneRelation | null {
  const mapped = LINEAR_TO_PLANE_RELATION[relation]
  if (!mapped) return null
  return mapped as PlaneRelation
}

/**
 * Convert Plane relation type to Linear
 */
export function planeRelationToLinear(relation: string): LinearRelation | null {
  const mapped = PLANE_TO_LINEAR_RELATION[relation]
  if (!mapped) return null
  return mapped as LinearRelation
}

/**
 * Check if relation is valid in Linear
 */
export function isValidLinearRelation(relation: string): boolean {
  return VALID_LINEAR_RELATIONS.includes(relation as LinearRelation)
}

/**
 * Check if relation is valid in Plane
 */
export function isValidPlaneRelation(relation: string): boolean {
  return VALID_PLANE_RELATIONS.includes(relation as PlaneRelation)
}

/**
 * Check if Plane relation has no Linear equivalent
 */
export function isPlaneOnlyRelation(relation: string): boolean {
  return PLANE_ONLY_RELATIONS.includes(relation as (typeof PLANE_ONLY_RELATIONS)[number])
}
