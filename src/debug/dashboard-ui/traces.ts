import { escapeHtml, formatTokens } from './helpers.js'

export function buildTraceDetail(t: {
  toolCalls?: Array<{ toolName: string; durationMs: number; success: boolean }>
  totalTokens?: { inputTokens: number; outputTokens: number }
  error?: string
}): string {
  let html = '<div class="trace-detail">'
  if (t.toolCalls !== undefined && t.toolCalls.length > 0) {
    for (const tc of t.toolCalls) {
      html += `<div class="trace-tool"><span>${escapeHtml(tc.toolName)}</span><span>${tc.durationMs}ms <span class="${tc.success ? 'tool-success' : 'tool-fail'}">${tc.success ? '\u2713' : '\u2717'}</span></span></div>`
    }
  }
  html += `<div class="trace-tokens">in: ${formatTokens(t.totalTokens?.inputTokens ?? 0)} \u00b7 out: ${formatTokens(t.totalTokens?.outputTokens ?? 0)}</div>`
  if (t.error !== undefined && t.error !== '') {
    html += `<div class="trace-error-msg">${escapeHtml(t.error)}</div>`
  }
  html += '</div>'
  return html
}
