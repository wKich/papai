import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { parseCliArgs } from '../../scripts/review-loop/cli.js'
import { loadReviewLoopConfig } from '../../scripts/review-loop/config.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-cli-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('review-loop CLI bootstrap', () => {
  test('parseCliArgs requires --plan and returns resume-run when provided', () => {
    expect(() => parseCliArgs(['--config', '.review-loop/config.json'])).toThrow('Missing required --plan')

    expect(
      parseCliArgs([
        '--config',
        '.review-loop/config.json',
        '--plan',
        'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md',
        '--resume-run',
        '2026-04-12T05-31-44Z',
      ]),
    ).toEqual({
      configPath: '.review-loop/config.json',
      planPath: 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md',
      repoRoot: undefined,
      resumeRunId: '2026-04-12T05-31-44Z',
    })
  })

  test('loadReviewLoopConfig resolves repo and plan paths and creates workDir', async () => {
    const dir = makeTempDir()
    const configPath = path.join(dir, 'review-loop.config.json')

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          repoRoot: dir,
          planPath: path.join(dir, 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md'),
          workDir: path.join(dir, '.review-loop'),
          maxRounds: 5,
          maxNoProgressRounds: 2,
          reviewer: {
            command: '/usr/local/bin/claude-acp-adapter',
            args: [],
            invocationPrefix: '/review-code',
            requireInvocationPrefix: false,
          },
          fixer: {
            command: 'opencode',
            args: ['acp'],
            verifyInvocationPrefix: '/verify-issue',
            fixInvocationPrefix: null,
            requireVerifyInvocation: false,
          },
        },
        null,
        2,
      ),
    )

    const config = await loadReviewLoopConfig({
      configPath,
      planPath: path.join(dir, 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md'),
    })

    expect(config.repoRoot).toBe(dir)
    expect(config.workDir).toBe(path.join(dir, '.review-loop'))
    expect(config.reviewer.invocationPrefix).toBe('/review-code')
    expect(config.fixer.verifyInvocationPrefix).toBe('/verify-issue')
  })
})
