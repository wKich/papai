// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  decisionConsequences,
  gateTitle,
  grammarLines,
  renderDecisions,
} from '../../../afk-runner/src/work/gate-decisions.js'

describe('gate front-matter copy (U3 D7)', () => {
  it('gateTitle names each mode', () => {
    expect(gateTitle('early', 'add-thing')).toBe('## Early gate (cap hit) — change add-thing')
    expect(gateTitle('final', 'add-thing')).toBe('## Final gate — change add-thing')
    expect(gateTitle('release', 'add-thing')).toBe('## Release gate — change add-thing')
  })

  it('the release grammar teaches approve/veto/abort and never mentions extend or boxes', () => {
    const lines = grammarLines('release').join('\n')
    expect(lines).toContain('APPROVE')
    expect(lines).toContain('VETO: <redirect>')
    expect(lines).toContain('ABORT')
    expect(lines).not.toContain('RUN 1 MORE')
    expect(lines).not.toContain('box')
  })

  it('release consequences offer no extend; the walk-shaped veto replaces the resolver pass', () => {
    expect(decisionConsequences('release')).toEqual({
      approve: 'completes the run',
      veto: 're-enters implement applying the redirects',
      extend: null,
      abort: 'aborts the run',
    })
  })

  it('renderDecisions release block is verb-only with no extend row', () => {
    const lines = renderDecisions('release')
    expect(lines).toContain('- **approve** (`APPROVE`) — completes the run')
    expect(lines).toContain('- **veto** (`VETO: <redirect>`) — re-enters implement applying the redirects')
    expect(lines).toContain('- **abort** (`ABORT`) — aborts the run; the only early exit that spends nothing further')
    expect(lines.join('\n')).not.toContain('**extend**')
  })
})
