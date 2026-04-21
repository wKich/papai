import { resolve } from 'node:path'

export const MODEL = 'Gemma-4-26B-A4B'
export const BASE_URL = 'http://localhost:8000/v1'

export const PROJECT_ROOT = resolve(import.meta.dir, '../..')

export const REPORTS_DIR = resolve(PROJECT_ROOT, 'reports')
export const AUDIT_BEHAVIOR_DIR = resolve(REPORTS_DIR, 'audit-behavior')

export const BEHAVIORS_DIR = resolve(AUDIT_BEHAVIOR_DIR, 'behaviors')
export const CLASSIFIED_DIR = resolve(AUDIT_BEHAVIOR_DIR, 'classified')
export const CONSOLIDATED_DIR = resolve(AUDIT_BEHAVIOR_DIR, 'consolidated')
export const STORIES_DIR = resolve(AUDIT_BEHAVIOR_DIR, 'stories')
export const PROGRESS_PATH = resolve(AUDIT_BEHAVIOR_DIR, 'progress.json')
export const INCREMENTAL_MANIFEST_PATH = resolve(AUDIT_BEHAVIOR_DIR, 'incremental-manifest.json')
export const CONSOLIDATED_MANIFEST_PATH = resolve(AUDIT_BEHAVIOR_DIR, 'consolidated-manifest.json')
export const KEYWORD_VOCABULARY_PATH = resolve(AUDIT_BEHAVIOR_DIR, 'keyword-vocabulary.json')

export const PHASE1_TIMEOUT_MS = 1_200_000
export const PHASE2_TIMEOUT_MS = 300_000
export const PHASE3_TIMEOUT_MS = 600_000
export const MAX_RETRIES = 3
export const RETRY_BACKOFF_MS = [100_000, 300_000, 900_000] as const
export const MAX_STEPS = 20

export const EXCLUDED_PREFIXES = [
  'tests/e2e/',
  'tests/client/',
  'tests/helpers/',
  'tests/scripts/',
  'tests/review-loop/',
  'tests/types/',
] as const
