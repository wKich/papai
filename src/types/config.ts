/**
 * Configuration types shared between production and tests.
 */

// Task-tracker specific config keys (filtered by TASK_PROVIDER env var)
export type TaskProviderConfigKey = 'kaneo_apikey' | 'youtrack_token'

// LLM config keys (always available)
export type LlmConfigKey = 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model'

// Proactive assistance config keys (always available)
export type ProactiveConfigKey =
  | 'briefing_time'
  | 'briefing_timezone'
  | 'briefing_mode'
  | 'deadline_nudges'
  | 'staleness_days'

// User preference config keys (always available)
export type PreferenceConfigKey = 'timezone'

// All config keys
export type ConfigKey = TaskProviderConfigKey | LlmConfigKey | PreferenceConfigKey | ProactiveConfigKey

// Get the task provider from env
const TASK_PROVIDER = process.env['TASK_PROVIDER'] ?? 'kaneo'

// Filter config keys based on the task provider
const PREFERENCE_KEYS: readonly PreferenceConfigKey[] = ['timezone']
const PROACTIVE_KEYS: readonly ProactiveConfigKey[] = [
  'briefing_time',
  'briefing_timezone',
  'briefing_mode',
  'deadline_nudges',
  'staleness_days',
]

function getConfigKeysForProvider(provider: string): readonly ConfigKey[] {
  const llmKeys: readonly LlmConfigKey[] = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model']

  if (provider === 'youtrack') {
    return [...llmKeys, 'youtrack_token', ...PREFERENCE_KEYS, ...PROACTIVE_KEYS]
  }

  // Default to kaneo
  return [...llmKeys, 'kaneo_apikey', ...PREFERENCE_KEYS, ...PROACTIVE_KEYS]
}

// Config keys available for the current task provider
export const CONFIG_KEYS: readonly ConfigKey[] = getConfigKeysForProvider(TASK_PROVIDER)
