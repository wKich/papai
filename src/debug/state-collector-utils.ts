export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

export function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

export function isTokenRecord(v: unknown): v is { inputTokens: unknown; outputTokens: unknown } {
  return typeof v === 'object' && v !== null && 'inputTokens' in v && 'outputTokens' in v
}

export function tokenUsage(value: unknown): { inputTokens: number; outputTokens: number } {
  if (isTokenRecord(value)) {
    return { inputTokens: num(value.inputTokens), outputTokens: num(value.outputTokens) }
  }
  return { inputTokens: 0, outputTokens: 0 }
}
