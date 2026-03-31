export declare function isTestFile(filePath: string): boolean
export declare function isGateableImplFile(filePath: string, projectRoot: string): boolean
export declare function suggestTestPath(implRelPath: string): string
export declare function findTestFile(implAbsPath: string, projectRoot: string): string | null
