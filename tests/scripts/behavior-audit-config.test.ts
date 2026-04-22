import { afterEach, expect, test } from 'bun:test'

import * as behaviorAuditConfig from '../../scripts/behavior-audit/config.js'
import { createAuditBehaviorConfig } from './behavior-audit-integration.helpers.js'
import { applyBehaviorAuditEnv, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import { isObject } from './behavior-audit-integration.support.js'

type ReloadableConfigModule = {
  readonly REPORTS_DIR: string
  readonly MAX_RETRIES: number
  readonly reloadBehaviorAuditConfig: () => void
}

function isReloadableConfigModule(value: unknown): value is ReloadableConfigModule {
  return (
    isObject(value) &&
    'reloadBehaviorAuditConfig' in value &&
    typeof value['reloadBehaviorAuditConfig'] === 'function' &&
    'REPORTS_DIR' in value &&
    typeof value['REPORTS_DIR'] === 'string' &&
    'MAX_RETRIES' in value &&
    typeof value['MAX_RETRIES'] === 'number'
  )
}

afterEach(() => {
  restoreBehaviorAuditEnv()
})

test('reloadBehaviorAuditConfig reapplies env overrides to exported config values', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  if (!isReloadableConfigModule(loadedConfig)) {
    throw new Error('Unexpected config module shape')
  }
  const config = loadedConfig

  process.env['BEHAVIOR_AUDIT_REPORTS_DIR'] = '/tmp/behavior-audit-reports'
  process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] = '7'

  config.reloadBehaviorAuditConfig()

  expect(config.REPORTS_DIR).toBe('/tmp/behavior-audit-reports')
  expect(config.MAX_RETRIES).toBe(7)
})

test('restoreBehaviorAuditEnv also restores live config exports for already-loaded modules', () => {
  const expectedMaxRetries =
    process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] === undefined ? 3 : Number(process.env['BEHAVIOR_AUDIT_MAX_RETRIES'])

  const testConfig = createAuditBehaviorConfig('/tmp/behavior-audit-runtime-helper', null)
  applyBehaviorAuditEnv({ ...testConfig, MAX_RETRIES: 0 })
  behaviorAuditConfig.reloadBehaviorAuditConfig()

  expect(behaviorAuditConfig.MAX_RETRIES).toBe(0)
  restoreBehaviorAuditEnv()

  expect(behaviorAuditConfig.MAX_RETRIES).toBe(expectedMaxRetries)
})
