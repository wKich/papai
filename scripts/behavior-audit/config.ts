import { resolve } from 'node:path'

const DEFAULT_PROJECT_ROOT = resolve(import.meta.dir, '../..')
const DEFAULT_REPORTS_DIR = resolve(DEFAULT_PROJECT_ROOT, 'reports')
const DEFAULT_AUDIT_BEHAVIOR_DIR = resolve(DEFAULT_REPORTS_DIR, 'audit-behavior')
const DEFAULT_EXCLUDED_PREFIXES = [
  'tests/e2e/',
  'tests/client/',
  'tests/helpers/',
  'tests/scripts/',
  'tests/review-loop/',
  'tests/types/',
] as const

function resolveNumberOverride(name: string, fallback: number): number {
  const rawValue = process.env[name]
  if (rawValue === undefined) {
    return fallback
  }

  const parsedValue = Number(rawValue)
  if (!Number.isFinite(parsedValue)) {
    return fallback
  }
  return parsedValue
}

function resolveStringOverride(name: string, fallback: string): string {
  const rawValue = process.env[name]
  if (rawValue === undefined) {
    return fallback
  }
  return rawValue
}

function resolveReadonlyStringList(name: string, fallback: readonly string[]): readonly string[] {
  const rawValue = process.env[name]
  if (rawValue === undefined) {
    return fallback
  }

  const parsedValue = rawValue
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return parsedValue.length > 0 ? parsedValue : fallback
}

export let MODEL = 'Gemma-4-26B-A4B'
export let BASE_URL = 'http://localhost:8000/v1'

export let PROJECT_ROOT = DEFAULT_PROJECT_ROOT

export let REPORTS_DIR = DEFAULT_REPORTS_DIR
export let AUDIT_BEHAVIOR_DIR = DEFAULT_AUDIT_BEHAVIOR_DIR

export let BEHAVIORS_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'behaviors')
export let CLASSIFIED_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'classified')
export let CONSOLIDATED_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'consolidated')
export let STORIES_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'stories')
export let PROGRESS_PATH = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'progress.json')
export let INCREMENTAL_MANIFEST_PATH = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'incremental-manifest.json')
export let CONSOLIDATED_MANIFEST_PATH = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'consolidated-manifest.json')
export let KEYWORD_VOCABULARY_PATH = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'keyword-vocabulary.json')

export let PHASE1_TIMEOUT_MS = 1_200_000
export let PHASE2_TIMEOUT_MS = 300_000
export let PHASE3_TIMEOUT_MS = 600_000
export let MAX_RETRIES = 3
export const RETRY_BACKOFF_MS = [100_000, 300_000, 900_000] as const
export let MAX_STEPS = 20

export let EXCLUDED_PREFIXES: readonly string[] = DEFAULT_EXCLUDED_PREFIXES

export function reloadBehaviorAuditConfig(): void {
  MODEL = resolveStringOverride('BEHAVIOR_AUDIT_MODEL', 'Gemma-4-26B-A4B')
  BASE_URL = resolveStringOverride('BEHAVIOR_AUDIT_BASE_URL', 'http://localhost:8000/v1')

  PROJECT_ROOT = resolveStringOverride('BEHAVIOR_AUDIT_PROJECT_ROOT', DEFAULT_PROJECT_ROOT)
  REPORTS_DIR = resolveStringOverride('BEHAVIOR_AUDIT_REPORTS_DIR', resolve(PROJECT_ROOT, 'reports'))
  AUDIT_BEHAVIOR_DIR = resolveStringOverride(
    'BEHAVIOR_AUDIT_AUDIT_BEHAVIOR_DIR',
    resolve(REPORTS_DIR, 'audit-behavior'),
  )

  BEHAVIORS_DIR = resolveStringOverride('BEHAVIOR_AUDIT_BEHAVIORS_DIR', resolve(AUDIT_BEHAVIOR_DIR, 'behaviors'))
  CLASSIFIED_DIR = resolveStringOverride('BEHAVIOR_AUDIT_CLASSIFIED_DIR', resolve(AUDIT_BEHAVIOR_DIR, 'classified'))
  CONSOLIDATED_DIR = resolveStringOverride(
    'BEHAVIOR_AUDIT_CONSOLIDATED_DIR',
    resolve(AUDIT_BEHAVIOR_DIR, 'consolidated'),
  )
  STORIES_DIR = resolveStringOverride('BEHAVIOR_AUDIT_STORIES_DIR', resolve(AUDIT_BEHAVIOR_DIR, 'stories'))
  PROGRESS_PATH = resolveStringOverride('BEHAVIOR_AUDIT_PROGRESS_PATH', resolve(AUDIT_BEHAVIOR_DIR, 'progress.json'))
  INCREMENTAL_MANIFEST_PATH = resolveStringOverride(
    'BEHAVIOR_AUDIT_INCREMENTAL_MANIFEST_PATH',
    resolve(AUDIT_BEHAVIOR_DIR, 'incremental-manifest.json'),
  )
  CONSOLIDATED_MANIFEST_PATH = resolveStringOverride(
    'BEHAVIOR_AUDIT_CONSOLIDATED_MANIFEST_PATH',
    resolve(AUDIT_BEHAVIOR_DIR, 'consolidated-manifest.json'),
  )
  KEYWORD_VOCABULARY_PATH = resolveStringOverride(
    'BEHAVIOR_AUDIT_KEYWORD_VOCABULARY_PATH',
    resolve(AUDIT_BEHAVIOR_DIR, 'keyword-vocabulary.json'),
  )

  PHASE1_TIMEOUT_MS = resolveNumberOverride('BEHAVIOR_AUDIT_PHASE1_TIMEOUT_MS', 1_200_000)
  PHASE2_TIMEOUT_MS = resolveNumberOverride('BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS', 300_000)
  PHASE3_TIMEOUT_MS = resolveNumberOverride('BEHAVIOR_AUDIT_PHASE3_TIMEOUT_MS', 600_000)
  MAX_RETRIES = resolveNumberOverride('BEHAVIOR_AUDIT_MAX_RETRIES', 3)
  MAX_STEPS = resolveNumberOverride('BEHAVIOR_AUDIT_MAX_STEPS', 20)
  EXCLUDED_PREFIXES = resolveReadonlyStringList('BEHAVIOR_AUDIT_EXCLUDED_PREFIXES', DEFAULT_EXCLUDED_PREFIXES)
}

reloadBehaviorAuditConfig()
