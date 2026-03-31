export declare function getSessionBaseline(
  sessionId: string,
  projectRoot: string,
): Record<string, { covered: number; total: number }> | null
