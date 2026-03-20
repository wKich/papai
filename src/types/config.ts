/**
 * Configuration types shared between production and tests.
 */

// Task-tracker specific config keys (filtered by TASK_PROVIDER env var)
export type TaskProviderConfigKey = 'kaneo_apikey' | 'youtrack_token'

// LLM config keys (always available)
export type LlmConfigKey = 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model'

// All config keys
export type ConfigKey = TaskProviderConfigKey | LlmConfigKey

// Get the task provider from env
const TASK_PROVIDER = process.env['TASK_PROVIDER'] ?? 'kaneo'

// Filter config keys based on the task provider
function getConfigKeysForProvider(provider: string): readonly ConfigKey[] {
  const llmKeys: readonly LlmConfigKey[] = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model']

  if (provider === 'youtrack') {
    return [...llmKeys, 'youtrack_token']
  }

  // Default to kaneo
  return [...llmKeys, 'kaneo_apikey']
}

// Config keys available for the current task provider
export const CONFIG_KEYS: readonly ConfigKey[] = getConfigKeysForProvider(TASK_PROVIDER)
