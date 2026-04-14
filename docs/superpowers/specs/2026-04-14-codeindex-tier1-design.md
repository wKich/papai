# codeindex: Tier 1 Code Indexing for AI Agents

**Date**: 2026-04-14
**Status**: Draft
**Scope**: Tier 1 — AST-based chunking + FTS5 keyword search + MCP server

## Problem

AI coding agents (Claude Code, opencode) navigate codebases by reading files sequentially. This wastes tokens on irrelevant code, misses hidden dependencies, and re-reads the same files across sessions. The agent has no structural map of the codebase — it treats code as flat text rather than a graph of symbols and relationships.

Existing tools address this with varying depth:

| Tool           | Stack             | Analysis depth                            | Agent-level benchmarks                                 | License     |
| -------------- | ----------------- | ----------------------------------------- | ------------------------------------------------------ | ----------- |
| codemogger     | TypeScript/libSQL | AST + embeddings                          | None (search latency only)                             | MIT         |
| Ory Lumen      | Go/SQLite-vec     | AST + embeddings                          | SWE-style: -37% cost, -37% time, 0 quality regressions | Apache 2.0  |
| CocoIndex Code | Python            | AST + embeddings                          | None (self-reported "70% savings")                     | Apache 2.0  |
| llm-tldr       | Python/FAISS      | 5 layers (AST, call graph, CFG, DFG, PDG) | None                                                   | AGPL-3.0    |
| GitNexus       | TypeScript/KuzuDB | Knowledge graph                           | None                                                   | NOASSERTION |
| Srclight       | Python/SQLite     | AST + call graphs + git blame             | None                                                   | MIT         |

Of these, only Ory Lumen has rigorous, reproducible agent-level benchmarks. The rest rely on self-reported search latency or unverified token savings claims.

None integrate with the papai stack (TypeScript/Bun, drizzle+better-sqlite3, pluggable embeddings via `src/embeddings.ts`). Building custom avoids license risks (AGPL, NOASSERTION), vendor lock-in (libSQL, KuzuDB, FAISS), and stack mismatches (Python in a Bun project).

## Solution

A standalone TypeScript/Bun tool called **codeindex** that parses codebases into semantic chunks using tree-sitter, stores them in SQLite with FTS5, and exposes search via an MCP server for opencode and Claude Code.

**Project location**: `codeindex/` directory at the papai repo root. Separate `package.json` and `tsconfig.json` so it can be extracted to its own repo later. Not a papai dependency — it's a development workflow tool that runs alongside the agent.

### Tier 1 scope

- AST-based chunking (functions, classes, interfaces, types, exports)
- Symbol extraction (name, type, file, line range)
- Import/call edge extraction (bridges to Layer 3)
- FTS5 full-text keyword search with weighted fields
- MCP server with search, index, reindex, and impact tools
- Incremental re-indexing (SHA-256 file hashes)
- Configurable via `.codeindex.json`

### Out of scope

- Vector embeddings / semantic search (Layer 2)
- Graph traversal / blast radius (Layer 3)
- Browser visualization
- Language server protocol

## Architecture

```
codeindex/
  src/
    index.ts          — CLI entry + MCP server startup
    indexer.ts        — directory walker + tree-sitter parser + chunker
    storage.ts        — SQLite schema, CRUD, FTS5 queries
    search.ts         — keyword search with ranking
    impact.ts         — reverse-edge lookup (callers/importers of a symbol)
    mcp/
      server.ts       — MCP tool definitions and dispatch
      tools.ts        — tool schemas (search, index, reindex, impact)
    tree-sitter/
      loader.ts       — grammar loading, language detection
      chunker.ts      — AST to semantic chunk extraction
      edges.ts        — import/call edge extraction
  .codeindex.json     — config file (per-project)
  .codeindex/         — SQLite db + cache (gitignored)
```

### Data flow

```
Source Files → tree-sitter → AST chunks + symbol edges → SQLite (FTS5 + chunks + edges)
                                                       ↕
                                            MCP server (stdio)
                                             ↕
                              opencode / Claude Code / any MCP client
```

## Data model

### chunks table

```sql
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,       -- format: "{relative_file_path}::{symbol_name}::{start_line}"
  file_path TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  symbol_type TEXT NOT NULL,  -- 'function' | 'class' | 'interface' | 'type' | 'variable' | 'export'
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  language TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);
```

### FTS5 virtual table

```sql
CREATE VIRTUAL TABLE fts_chunks USING fts5(
  symbol_name,
  content,
  file_path,
  content='chunks',
  content_rowid='rowid',
  tokenize='porter'
);
```

### edges table

```sql
CREATE TABLE edges (
  source_id TEXT NOT NULL REFERENCES chunks(id),
  target_id TEXT REFERENCES chunks(id),
  target_symbol TEXT NOT NULL,
  edge_type TEXT NOT NULL,  -- 'imports' | 'calls' | 'implements' | 'extends'
  file_path TEXT NOT NULL
);

CREATE INDEX idx_edges_target_symbol ON edges(target_symbol);
CREATE INDEX idx_edges_source_id ON edges(source_id);
CREATE INDEX idx_edges_edge_type ON edges(edge_type);

CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO fts_chunks(rowid, symbol_name, content, file_path)
  VALUES (new.rowid, new.symbol_name, new.content, new.file_path);
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO fts_chunks(fts_chunks, rowid, symbol_name, content, file_path)
  VALUES ('delete', old.rowid, old.symbol_name, old.content, old.file_path);
END;
```

`target_id` is NULL for unresolved external symbols (npm packages, not-yet-indexed modules). `target_symbol` enables fuzzy reverse lookup for impact analysis.

## Indexing pipeline

1. **Scan** — Walk directory from root, respect `.gitignore` + `.codeindex.json` excludes. Detect language from file extension.

2. **Parse** — For each file, load the appropriate tree-sitter grammar, parse to AST. Supported languages for Tier 1: TypeScript, JavaScript, TSX, JSX. Extensible grammar registry for future languages.

3. **Chunk** — Walk the AST, extract top-level definitions:
   - Functions (including arrow functions assigned to `const`)
   - Classes and class methods
   - Interfaces and type aliases
   - Named exports
   - Items exceeding 100 lines split into sub-chunks at natural boundaries (closing braces, blank lines)

4. **Extract edges** — For each chunk, parse:
   - Import statements to `imports` edges to target symbols
   - Function calls to `calls` edges to target symbols
   - `implements`/`extends` clauses to `implements`/`extends` edges
   - Edges with unresolved targets store `target_id = NULL` with `target_symbol` for partial matching

5. **Store** — Upsert chunks, delete stale chunks for changed files, rebuild FTS5 index for affected files. Track file hashes (SHA-256) for incremental updates. Only re-parse files whose hash changed since last index.

## Search

### Keyword search (FTS5)

- Weighted fields: `symbol_name^3` (highest priority), `content^1`, `file_path^0.5`
- Porter stemmer tokenizer handles plurals and verb forms
- Returns: symbol name, type, file path, line range, content snippet

### Search modes (exposed via MCP)

| Mode       | Behavior                                                                        |
| ---------- | ------------------------------------------------------------------------------- |
| `keyword`  | FTS5 only. Default for Tier 1.                                                  |
| `semantic` | Vector search. Returns "not available in Tier 1" for now. Reserved for Layer 2. |
| `auto`     | Try keyword first, fall back to semantic when available.                        |

### Impact analysis

Using the edges table:

- `code_impact(symbol)` finds all chunks that import/call/extend the given symbol
- Returns reverse graph: who depends on this symbol
- Handles partial matches via `target_symbol` for symbols not in the same codebase
- Matches by symbol name substring for resilience against import path differences

## MCP server

Four tools exposed via stdio:

### code_search

Search the indexed codebase by keyword.

```
Parameters:
  query: string (required) — search query
  mode?: "keyword" | "semantic" | "auto" — search mode (default: "keyword")
  limit?: number — max results (default: 10)

Returns: Array of {
  symbol_name, symbol_type, file_path,
  start_line, end_line, content, score
}
```

### code_index

Index a codebase for the first time.

```
Parameters:
  path: string (required) — path to codebase root

Returns: { files_scanned, chunks_created, edges_created, time_ms }
```

### code_reindex

Incrementally update the index after file changes.

```
Parameters:
  path: string (required) — path to codebase root

Returns: { files_changed, chunks_added, chunks_removed, edges_updated, time_ms }
```

### code_impact

Find all code that depends on a given symbol.

```
Parameters:
  symbol: string (required) — symbol name to search for

Returns: Array of {
  symbol_name, symbol_type, file_path,
  start_line, end_line, edge_type
}
```

## Integration

### opencode config

```json
{
  "mcp": {
    "codeindex": {
      "type": "local",
      "command": ["bun", "run", "/path/to/codeindex/src/index.ts", "mcp"],
      "enabled": true
    }
  }
}
```

### Claude Code config

```json
{
  "mcpServers": {
    "codeindex": {
      "command": "bun",
      "args": ["run", "/path/to/codeindex/src/index.ts", "mcp"]
    }
  }
}
```

## Configuration (`.codeindex.json`)

```json
{
  "roots": ["src/", "client/"],
  "exclude": ["node_modules/", "dist/", ".git/", "coverage/", "*.test.*", "*.spec.*"],
  "languages": ["typescript", "javascript", "tsx", "jsx"],
  "chunk_max_lines": 100,
  "db_path": ".codeindex/index.db"
}
```

| Field             | Type     | Default                      | Description                          |
| ----------------- | -------- | ---------------------------- | ------------------------------------ |
| `roots`           | string[] | ["src/"]                     | Directories to index                 |
| `exclude`         | string[] | gitignore + test patterns    | Glob patterns to skip                |
| `languages`       | string[] | ["typescript", "javascript"] | Languages to parse                   |
| `chunk_max_lines` | number   | 100                          | Max lines per chunk before splitting |
| `db_path`         | string   | ".codeindex/index.db"        | SQLite database path                 |

## CLI commands

```bash
codeindex index .              # Full index
codeindex reindex .            # Incremental update
codeindex search "auth"        # CLI search (for testing)
codeindex impact "handleAuth"  # Impact analysis by symbol name
codeindex mcp                  # Start MCP server (stdio)
codeindex stats                # Show indexing stats
```

## Future iterations

### Layer 2 — Vector embeddings

- Add `embedding BLOB` column to chunks table
- Add sqlite-vec virtual table for vector similarity search
- Plug in embedding function via config (MiniLM local, or OpenAI-compatible API reusing papai's embedding DI pattern from `src/embeddings.ts`)
- The `mode: 'semantic'` search option activates
- Hybrid search: Reciprocal Rank Fusion (RRF) combining FTS5 + vector scores
- Embedding model configurable per project (same pattern as papai's per-user `embedding_model` config)

### Layer 3 — Knowledge graph

- Promote edges table to full graph with BFS traversal via recursive CTEs on SQLite
- Add `code_paths` MCP tool: show the execution path from symbol A to symbol B
- Add `code_blast_radius` MCP tool: what breaks if I delete this symbol
- Consider graduating to KuzuDB if recursive CTEs prove insufficient for multi-hop queries
- Add visualization (Axon-style force-directed graph via web dashboard)

### Cross-session persistence

- The `.codeindex/` directory persists across agent sessions
- Agent does not need to re-read files it already indexed
- Optional git hook (post-commit) triggers incremental reindex automatically

### Multi-language expansion

- Tier 1 ships with TypeScript/JavaScript/TSX/JSX grammars
- Python grammar added for papai's test infrastructure
- Additional grammars (Go, Rust, etc.) loaded dynamically based on config

## Decision log

| Decision                       | Rationale                                                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom build over codemogger   | Avoids libSQL vendor lock-in; integrates with papai's SQLite + embedding stack; MIT license                                                                                       |
| Custom build over llm-tldr     | AGPL-3.0 license incompatible; Python stack mismatch; 5-layer analysis is Layer 3 scope                                                                                           |
| Custom build over GitNexus     | NOASSERTION license risk; KuzuDB overkill for Tier 1; over-engineered for current needs                                                                                           |
| Edges table in Tier 1          | Zero-cost addition (extracted during AST walk) that bridges to Layer 3 without re-architecture                                                                                    |
| FTS5 over BM25                 | FTS5 is built into SQLite; no external dependency; porter stemmer handles most English variations                                                                                 |
| tree-sitter WASM over native   | WASM grammars are portable, don't require native compilation, and work on all platforms. Uses `web-tree-sitter` npm package with pre-built WASM grammars from `tree-sitter-wasms` |
| Impact tool in Tier 1          | Simple reverse-edge lookup on the edges table; provides immediate value for refactoring tasks                                                                                     |
| Project location at papai root | Keeps the tool close to its primary consumer; separate package.json enables future extraction                                                                                     |
