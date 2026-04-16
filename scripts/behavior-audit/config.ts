import { resolve } from 'node:path'

export const MODEL = 'qwen3-30b-a3b'
export const BASE_URL = 'http://localhost:1234/v1'

export const PROJECT_ROOT = resolve(import.meta.dir, '../..')

export const REPORTS_DIR = resolve(PROJECT_ROOT, 'reports')
export const BEHAVIORS_DIR = resolve(REPORTS_DIR, 'behaviors')
export const STORIES_DIR = resolve(REPORTS_DIR, 'stories')
export const PROGRESS_PATH = resolve(REPORTS_DIR, 'progress.json')

export const PHASE1_TIMEOUT_MS = 1_200_000
export const PHASE2_TIMEOUT_MS = 600_000
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
