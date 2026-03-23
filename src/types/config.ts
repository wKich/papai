/**
 * Configuration types shared between production and tests.
 */

// Task-tracker specific config keys (filtered by TASK_PROVIDER env var)
export type TaskProviderConfigKey = 'kaneo_apikey' | 'youtrack_token'

// LLM config keys (always available)
export type LlmConfigKey = 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model'

// Internal config keys — managed via LLM tools, not the /set command, not shown in /config
export type InternalConfigKey = 'briefing_time' | 'deadline_nudges' | 'staleness_days'

// User preference config keys (always available)
export type PreferenceConfigKey = 'timezone'

// All config keys (includes internal keys for type-safe internal access)
export type ConfigKey = TaskProviderConfigKey | LlmConfigKey | PreferenceConfigKey | InternalConfigKey

// Get the task provider from env
const TASK_PROVIDER = process.env['TASK_PROVIDER'] ?? 'kaneo'

// User-visible config keys: shown in /config and settable via /set
// Internal keys are intentionally excluded here
const PREFERENCE_KEYS: readonly PreferenceConfigKey[] = ['timezone']

function getConfigKeysForProvider(provider: string): readonly ConfigKey[] {
  const llmKeys: readonly LlmConfigKey[] = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model']

  if (provider === 'youtrack') {
    return [...llmKeys, 'youtrack_token', ...PREFERENCE_KEYS]
  }

  // Default to kaneo
  return [...llmKeys, 'kaneo_apikey', ...PREFERENCE_KEYS]
}

// Config keys available for the current task provider (user-visible only)
export const CONFIG_KEYS: readonly ConfigKey[] = getConfigKeysForProvider(TASK_PROVIDER)
