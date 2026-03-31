export interface Surface {
  exports: string[]
  signatures: Record<string, number>
}

export declare function extractSurface(filePath: string): Surface
