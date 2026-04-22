# Codeindex Workspace

## Purpose

`codeindex/` is a standalone Bun workspace for symbol-first TypeScript/JavaScript indexing and MCP-backed code search. It is local developer tooling for agents and maintainers, not a papai runtime dependency.

## Storage

- The default database path is `.codeindex/index.db` relative to the indexed repo root.
- When you run the workspace from `/home/runner/work/papai/papai/codeindex`, that default lands at `codeindex/.codeindex/index.db`.
- SQLite runs in WAL mode via `openDatabase()`, so expect sibling `-wal` and `-shm` files while the database is open.
- The incoming-reference table is named `symbol_references`, not `references`, because `REFERENCES` is a SQLite keyword.

## Scripts

Run workspace commands from the repo root:

- `bun run codeindex:test`
- `bun run codeindex:typecheck`
- `bun run codeindex:lint`
- `bun run codeindex:format:check`

## TDD Hooks

The repo TDD resolver treats `codeindex/src/**` as gateable implementation code and maps it to `tests/codeindex/**`. Keep new codeindex implementation work aligned with the same test-first flow used under `src/`.

## Current Parser Setup

- `web-tree-sitter` bootstraps the parser runtime.
- The workspace currently loads grammar wasm files from `tree-sitter-javascript` and `tree-sitter-typescript`, which ship `.wasm` artifacts compatible with the current runtime.
