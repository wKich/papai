import { beforeEach, describe, expect, mock, test } from 'bun:test'

const parserInit = mock((_options?: unknown) => Promise.resolve())
const loadLanguage = mock((wasmPath: string) => Promise.resolve({ wasmPath }))
const setLanguage = mock((_language: unknown) => {})

describe('createParserLoader', () => {
  beforeEach(() => {
    parserInit.mockClear()
    loadLanguage.mockClear()
    setLanguage.mockClear()
  })

  test('loads javascript and typescript-family grammars once', async () => {
    const { createParserLoader } = await import('../../codeindex/src/indexer/parser.js')
    class FakeParser {
      static init(options?: unknown): Promise<void> {
        void options
        return parserInit()
      }

      parse(): null {
        return null
      }

      setLanguage(language: unknown): void {
        setLanguage(language)
      }
    }

    const loader = await createParserLoader({
      loadModule: () =>
        Promise.resolve({
          Parser: FakeParser,
          Language: {
            load: loadLanguage,
          },
        }),
    })

    await loader.createParserForExtension('.ts')
    await loader.createParserForExtension('.tsx')
    await loader.createParserForExtension('.js')

    expect(parserInit).toHaveBeenCalledTimes(1)
    const wasmPaths = loadLanguage.mock.calls.map((call) => call[0])
    expect(wasmPaths).toHaveLength(3)
    expect(wasmPaths[0]).toContain('tree-sitter-typescript/tree-sitter-typescript.wasm')
    expect(wasmPaths[1]).toContain('tree-sitter-typescript/tree-sitter-tsx.wasm')
    expect(wasmPaths[2]).toContain('tree-sitter-javascript/tree-sitter-javascript.wasm')
    expect(setLanguage).toHaveBeenCalledTimes(3)
  })
})
