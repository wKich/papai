import { describe, expect, test } from 'bun:test'

import { PLUGIN_API_VERSION, pluginManifestSchema } from '../../src/plugins/types.js'

const baseManifest = {
  id: 'hello-world',
  name: 'Hello World',
  version: '1.0.0',
  description: 'A test plugin',
  apiVersion: PLUGIN_API_VERSION,
}

describe('pluginManifestSchema', () => {
  test('accepts a minimal valid manifest', () => {
    const result = pluginManifestSchema.safeParse(baseManifest)
    expect(result.success).toBe(true)
  })

  test('applies defaults for optional fields', () => {
    const result = pluginManifestSchema.safeParse(baseManifest)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.main).toBe('index.ts')
    expect(result.data.contributes.tools).toEqual([])
    expect(result.data.permissions).toEqual([])
    expect(result.data.defaultEnabled).toBe(false)
    expect(result.data.activationTimeoutMs).toBe(5000)
  })

  describe('id validation', () => {
    test.each(['hello-world', 'my-plugin', 'a', 'plugin123', 'p-1-2'])('accepts valid id "%s"', (id) => {
      const result = pluginManifestSchema.safeParse({ ...baseManifest, id })
      expect(result.success).toBe(true)
    })

    test.each(['Hello', '-bad', '1bad', '', 'UPPER', 'has space', 'has_underscore'])(
      'rejects invalid id "%s"',
      (id) => {
        const result = pluginManifestSchema.safeParse({ ...baseManifest, id })
        expect(result.success).toBe(false)
      },
    )

    test('rejects id longer than 64 chars', () => {
      const result = pluginManifestSchema.safeParse({ ...baseManifest, id: 'a'.repeat(65) })
      expect(result.success).toBe(false)
    })
  })

  describe('version validation', () => {
    test('accepts semver versions', () => {
      expect(pluginManifestSchema.safeParse({ ...baseManifest, version: '1.0.0' }).success).toBe(true)
      expect(pluginManifestSchema.safeParse({ ...baseManifest, version: '2.3.4' }).success).toBe(true)
    })

    test('rejects non-semver versions', () => {
      expect(pluginManifestSchema.safeParse({ ...baseManifest, version: '1.0' }).success).toBe(false)
      expect(pluginManifestSchema.safeParse({ ...baseManifest, version: 'v1.0.0' }).success).toBe(false)
    })
  })

  describe('apiVersion validation', () => {
    test('accepts current PLUGIN_API_VERSION', () => {
      expect(PLUGIN_API_VERSION).toBe(1)
      expect(pluginManifestSchema.safeParse({ ...baseManifest, apiVersion: 1 }).success).toBe(true)
    })

    test('rejects other apiVersion values', () => {
      expect(pluginManifestSchema.safeParse({ ...baseManifest, apiVersion: 2 }).success).toBe(false)
      expect(pluginManifestSchema.safeParse({ ...baseManifest, apiVersion: 0 }).success).toBe(false)
    })
  })

  describe('main path validation', () => {
    test.each(['index.ts', 'lib/main.ts', 'dist/index.js'])('accepts valid main path "%s"', (main) => {
      const result = pluginManifestSchema.safeParse({ ...baseManifest, main })
      expect(result.success).toBe(true)
    })

    test.each(['/abs/path.ts', '../escape.ts', 'no-extension', 'file.txt'])(
      'rejects invalid main path "%s"',
      (main) => {
        const result = pluginManifestSchema.safeParse({ ...baseManifest, main })
        expect(result.success).toBe(false)
      },
    )
  })

  describe('contributes validation', () => {
    test('accepts valid tool names', () => {
      const result = pluginManifestSchema.safeParse({
        ...baseManifest,
        contributes: { tools: ['my_tool', 'another_one'] },
      })
      expect(result.success).toBe(true)
    })

    test('rejects tool names with hyphens', () => {
      const result = pluginManifestSchema.safeParse({
        ...baseManifest,
        contributes: { tools: ['my-tool'] },
      })
      expect(result.success).toBe(false)
    })
  })

  describe('permissions validation', () => {
    test('accepts valid permission values', () => {
      const result = pluginManifestSchema.safeParse({
        ...baseManifest,
        permissions: ['storage', 'tasks.read'],
      })
      expect(result.success).toBe(true)
    })

    test('rejects unknown permissions', () => {
      const result = pluginManifestSchema.safeParse({
        ...baseManifest,
        permissions: ['storage', 'unknown.perm'],
      })
      expect(result.success).toBe(false)
    })
  })

  describe('activationTimeoutMs validation', () => {
    test('accepts values in 100–10000 range', () => {
      expect(pluginManifestSchema.safeParse({ ...baseManifest, activationTimeoutMs: 100 }).success).toBe(true)
      expect(pluginManifestSchema.safeParse({ ...baseManifest, activationTimeoutMs: 10000 }).success).toBe(true)
    })

    test('rejects values outside range', () => {
      expect(pluginManifestSchema.safeParse({ ...baseManifest, activationTimeoutMs: 99 }).success).toBe(false)
      expect(pluginManifestSchema.safeParse({ ...baseManifest, activationTimeoutMs: 10001 }).success).toBe(false)
    })
  })

  test('accepts a full featured manifest', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      author: 'Test Author',
      homepage: 'https://example.com',
      license: 'MIT',
      permissions: ['storage', 'tasks.read'],
      contributes: {
        tools: ['greet'],
        promptFragments: ['greeting-hint'],
        commands: ['greet-command'],
        configKeys: ['greeting_text'],
      },
      configRequirements: [{ key: 'greeting_text', label: 'Greeting text', required: false }],
      requiredTaskCapabilities: ['tasks.delete'],
      requiredChatCapabilities: ['messages.buttons'],
      activationTimeoutMs: 3000,
      defaultEnabled: true,
    })
    expect(result.success).toBe(true)
  })
})
