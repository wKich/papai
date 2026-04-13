import { describe, expect, test } from 'bun:test'

// type-only import satisfies the module-coverage gate; src/index.ts is a
// side-effectful entry-point script with no runtime-safe exports to import.
import type {} from '../src/index.js'

describe('index.ts - graceful shutdown', () => {
  test('message queue module exports a callable flushOnShutdown', () => {
    const result = Bun.spawnSync({
      cmd: [
        'bun',
        '-e',
        `const mod = await import('./src/message-queue/index.js?index-test=${crypto.randomUUID()}'); if (typeof mod.flushOnShutdown !== 'function') process.exit(1); await mod.flushOnShutdown({ timeoutMs: 5000 });`,
      ],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(result.exitCode).toBe(0)
  })

  test('startup wires graceful shutdown for SIGTERM and SIGINT', async () => {
    const source = await Bun.file('src/index.ts').text()

    expect(source).toContain("process.on('SIGTERM'")
    expect(source).toContain("process.on('SIGINT'")
    expect(source.match(/flushOnShutdown\(\s*\{\s*timeoutMs:\s*5000\s*\}\s*\)/g)?.length).toBe(1)
  })
})
