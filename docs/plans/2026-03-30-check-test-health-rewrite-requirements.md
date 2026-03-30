# Test Health Script Rewrite - Requirements Document

## Status: Draft

## Problem Statement

The current `check-test-health.ts` script uses the TypeScript Compiler API to detect test pollution patterns but relies on regex-based heuristics and pattern matching to identify mutable state (Pattern 4). This approach:

1. **Produces false positives** - Flags immutable constants as mutable because it can't verify actual mutation
2. **Requires manual exemptions** - Uses `IMMUTABLE_STATE_PATTERNS` regex to skip files
3. **Cannot verify actual usage** - Can't confirm if reset functions are actually called in tests
4. **Limited cross-file analysis** - Builds import graphs manually without using TypeScript's Language Service

## Objective

Rewrite `check-test-health.ts` using the **Raw TypeScript Compiler API with Language Service** to:

- Eliminate false positives by detecting actual mutations vs immutable declarations
- Remove manual pattern exemptions through semantic analysis
- Verify that exported reset functions are actually invoked in tests
- Provide accurate cross-file reference tracking

## Compatibility Requirements

- **TypeScript Version**: Must work with TypeScript 6.x (current project version)
- **Runtime**: Bun (not Node)
- **Dependencies**: Use project's TypeScript installation only (no ts-morph due to TS6 incompatibility)

## Required TypeScript Compiler APIs

### 1. Program Creation

```typescript
ts.createProgram(
  rootNames: string[],
  options: ts.CompilerOptions,
  host?: ts.CompilerHost
)
```

**Purpose**: Create a TypeScript program from project files to access the full compilation context.

### 2. Language Service

```typescript
ts.createLanguageService(
  host: ts.LanguageServiceHost,
  documentRegistry?: ts.DocumentRegistry
)
```

**Purpose**: Access Language Service for cross-file operations like `findReferences()`.

### 3. Find References API

```typescript
languageService.findReferences(
  fileName: string,
  position: number
): ts.ReferencedSymbol[]
```

**Purpose**: Find all references to a declaration across the entire project (Pattern 4).

### 4. AST Navigation APIs

```typescript
ts.forEachChild(node, callback) // Walk AST
node.getChildren() // Get child nodes
node.getFullText() // Get source text
sf.getLineAndCharacterOfPosition(pos) // Convert position to line/column
```

**Purpose**: Navigate and inspect AST nodes.

### 5. Type Checker

```typescript
program.getTypeChecker()
typeChecker.getSymbolAtLocation(node)
typeChecker.getExportsOfModule(symbol)
```

**Purpose**: Access type information and symbols for semantic analysis.

### 6. Source File Access

```typescript
program.getSourceFile(fileName: string)
program.getSourceFiles()
```

**Purpose**: Access parsed source files.

## Functional Requirements

### Pattern 1: Barrel Mock Detection (HIGH)

**Current Implementation**: Analyzes re-exports using `extractReExports()`
**Required Enhancement**:

- Use TypeScript's module resolution to accurately identify barrel files
- Detect when a mock targets a file that re-exports from other modules
- Identify which sub-modules are affected by the mock

**APIs Needed**:

- `ts.resolveModuleName()` - Resolve import specifiers
- `typeChecker.getExportsOfModule()` - Get exports of a module
- Manual AST walking to detect `export * from './module'` patterns

### Pattern 2: Shared Module Mock Without Cleanup (MEDIUM)

**Current Implementation**: Tracks mocks and checks for `afterAll(() => { mock.restore() })`
**Required Enhancement**:

- Same as current, but use Language Service to verify cross-file impact

**APIs Needed**:

- `hasRestoreCleanup()` - Keep current AST-based implementation
- Import graph building using `ts.resolveModuleName()`

### Pattern 3: Transitive Mock Pollution (HIGH)

**Current Implementation**: Uses `findTransitiveImporters()` with manual graph
**Required Enhancement**:

- Use TypeScript's module resolution for accurate dependency tracking
- Leverage Language Service to find all importers of a module

**APIs Needed**:

- `languageService.findReferences()` on module specifiers
- `ts.preProcessFile()` - Get import/require information

### Pattern 4: Module-Level Mutable State (MEDIUM)

**Current Implementation**: Uses `extractModuleLevelState()` with regex detection
**Required Replacement**:

- For each module-level variable declaration:
  1. Use `languageService.findReferences()` to find all usages
  2. Analyze each reference to determine if it's a mutation:
     - Assignment expressions: `x = value`, `x += value`
     - Mutating method calls: `array.push()`, `map.set()`, etc.
     - Property assignments: `obj.prop = value`
  3. If no mutations found, skip (no false positive)
  4. If mutations exist, check for exported reset function
  5. If reset function exists, verify it's called in test files using `findReferences()`

**APIs Needed**:

- `languageService.findReferences()` - Cross-file reference tracking
- `ts.isBinaryExpression()`, `ts.isCallExpression()` - AST node type checks
- `ts.SyntaxKind.EqualsToken` - Check for assignment operators
- Manual parent node analysis to detect mutation contexts

**Mutation Detection Logic**:

```typescript
function isMutation(reference: ts.ReferenceEntry): boolean {
  const node = reference.getNode()
  const parent = node.getParent()

  // Direct assignment: x = value
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === node
  ) {
    return true
  }

  // Mutating method call: x.push(), x.set()
  if (ts.isCallExpression(parent)) {
    const expr = parent.expression
    if (ts.isPropertyAccessExpression(expr)) {
      const methodName = expr.name.text
      return ['push', 'pop', 'shift', 'unshift', 'splice', 'set', 'delete', 'clear', 'add'].includes(methodName)
    }
  }

  // Property assignment on object: x.prop = value
  if (ts.isPropertyAccessExpression(parent) && ts.isBinaryExpression(parent.getParent())) {
    const grandparent = parent.getParent()
    if (grandparent.operatorToken.kind === ts.SyntaxKind.EqualsToken && grandparent.left === parent) {
      return true
    }
  }

  return false
}
```

## Implementation Architecture

### Phase 1: Setup

1. Load `tsconfig.json` from project root
2. Create `ts.CompilerHost` with Bun file system
3. Create `ts.LanguageServiceHost` implementation
4. Initialize `ts.LanguageService`

### Phase 2: Analysis

1. Get all source files from the program
2. Separate test files (\*.test.ts) from source files
3. For each pattern, apply detection logic using Language Service

### Phase 3: Reporting

1. Collect all issues found
2. Categorize by severity (HIGH/MEDIUM)
3. Output formatted report with file paths and line numbers
4. Exit with appropriate code for CI integration

## Performance Considerations

- **Language Service Initialization**: One-time cost, ~100-500ms for medium projects
- **Reference Finding**: O(n) where n = total references across project
- **File I/O**: Use Bun's fast file system operations
- **Caching**: Language Service caches parsed ASTs automatically

## Testing the Rewrite

The rewrite should:

1. Detect all current issues without false positives from `IMMUTABLE_STATE_PATTERNS`
2. Correctly identify that `DM_USER_HELP`, migration objects are immutable
3. Correctly identify that `jsCache` in debug/server.ts is NOT mutated between tests
4. Accurately track cross-file references
5. Complete within 5 seconds for the current codebase

## Risks and Mitigations

| Risk                                         | Mitigation                                            |
| -------------------------------------------- | ----------------------------------------------------- |
| Language Service API complexity              | Start with simple reference finding, expand gradually |
| Performance degradation with large codebases | Implement incremental analysis, cache results         |
| TypeScript 6 API changes                     | Pin TypeScript version, test on upgrade               |
| Edge cases in mutation detection             | Add test cases for each mutation pattern              |

## Success Criteria

1. **Zero false positives** - No `IMMUTABLE_STATE_PATTERNS` exemptions needed
2. **Accurate mutation detection** - Correctly identifies truly mutable state
3. **Cross-file verification** - Reset functions verified to be called in tests
4. **Performance** - < 5 seconds for current codebase
5. **TypeScript 6 compatibility** - Uses project's TypeScript installation

## Future Enhancements

- Detect test files that import mocked modules without cleanup
- Suggest auto-fixes for detected issues
- Integration with IDE for real-time feedback

## References

- [TypeScript Compiler API Documentation](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [Language Service API](https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API)
- Current implementation: `scripts/check-test-health.ts`
