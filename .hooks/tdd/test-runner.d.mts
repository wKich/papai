export interface TestResult {
  passed: boolean
  output: string
}

export declare function runTest(testFilePath: string, projectRoot: string): Promise<TestResult>
