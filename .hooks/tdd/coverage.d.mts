export interface CoverageStats {
  covered: number
  total: number
}

export declare function getFullCoverage(projectRoot: string): Record<string, CoverageStats> | null
export declare function getCoverage(testFile: string, implAbsPath: string, projectRoot: string): CoverageStats | null
