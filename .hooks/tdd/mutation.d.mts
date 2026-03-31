export interface Survivor {
  mutator: string
  replacement: string
  line: number | undefined
  description: string
}

export declare function extractSurvivors(report: unknown, targetAbsPath: string): Survivor[]
export declare function buildStrykerConfig(absPath: string, cwd: string, reportFile: string): Record<string, unknown>
