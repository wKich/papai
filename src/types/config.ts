/**
 * Configuration types shared between production and tests.
 */

export type ConfigKey =
  | 'provider'
  | 'kaneo_apikey'
  | 'youtrack_url'
  | 'youtrack_token'
  | 'llm_apikey'
  | 'llm_baseurl'
  | 'main_model'
  | 'small_model'

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'provider',
  'kaneo_apikey',
  'youtrack_url',
  'youtrack_token',
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
]
