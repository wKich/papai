export interface PendingFailure {
  file: string
  output: string
}

export interface SurfaceSnapshot {
  surface: { exports: string[]; signatures: Record<string, number> }
  coverage: { covered: number; total: number } | null
  filePath: string
}

export interface MutationSnapshot {
  survivors: Array<{ mutator: string; replacement: string; line?: number; description: string }>
  filePath: string
}

export declare class FileSessionState {
  constructor(sessionId: string, stateDir: string)
  getWrittenTests(): string[]
  addWrittenTest(testPath: string): void
  getPendingFailure(): PendingFailure | null
  setPendingFailure(file: string, output: string): void
  clearPendingFailure(): void
}

export declare class MemorySessionState {
  constructor(sessionId: string)
  getWrittenTests(): string[]
  addWrittenTest(testPath: string): void
  getPendingFailure(): PendingFailure | null
  setPendingFailure(file: string, output: string): void
  clearPendingFailure(): void
  getSurfaceSnapshot(fileKey: string): SurfaceSnapshot | null
  setSurfaceSnapshot(fileKey: string, data: SurfaceSnapshot): void
  getMutationSnapshot(fileKey: string): MutationSnapshot | null
  setMutationSnapshot(fileKey: string, data: MutationSnapshot): void
  getCoverageBaseline(): Record<string, { covered: number; total: number }> | null
  setCoverageBaseline(baseline: Record<string, { covered: number; total: number }>): void
  static reset(): void
}
