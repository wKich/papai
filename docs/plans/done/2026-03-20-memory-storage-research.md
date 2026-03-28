# Memory Storage Research for Phase 6: Personal Memory & Recall

**Date:** 2026-03-20  
**Status:** Research  
**Goal:** Evaluate storage solutions for memo capture, keyword search, semantic recall, and relationship-aware retrieval

---

## Context & Requirements

papai is a Bun + TypeScript Telegram bot that already uses:

- **SQLite** via `bun:sqlite` + Drizzle ORM for all persistence (users, config, conversation history, memory facts)
- **Vercel AI SDK** (`ai` package) for LLM interaction — includes `embed()`, `embedMany()`, and `cosineSimilarity()` functions
- **Docker** (`oven/bun:1-alpine`) for production deployment
- **No external database services** — everything is a single `papai.db` file

### What the memo system needs

| Capability                             | User Story         | Priority |
| -------------------------------------- | ------------------ | -------- |
| CRUD for free-form notes               | US1, US5, US6, US7 | Must     |
| Full-text keyword/tag search           | US3                | Must     |
| Semantic search (by meaning)           | US4                | Must     |
| Relationships (memo↔task, memo↔memo)   | US2, US5           | Should   |
| Lifecycle management (archive, expire) | US7                | Should   |
| Per-user isolation                     | All                | Must     |

### Scale expectations

Personal assistant for a small number of users. Realistic ceiling: **hundreds to low thousands of memos per user**. This is not a web-scale problem — sub-second latency on ~10K vectors is trivial even with brute-force.

---

## Category 1: SQLite + Embeddings (extend current stack)

### Option A: SQLite + brute-force cosine similarity in JS

Store embeddings as BLOBs in a `memos` table. At query time, load all embeddings into memory and compute cosine similarity in TypeScript using Vercel AI SDK's `cosineSimilarity()`.

| Aspect                | Assessment                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New dependencies**  | **Zero** — uses `bun:sqlite` (already present) + `ai` SDK (already present)                                                                                                                                                 |
| **Simplicity**        | Trivial. Just a new Drizzle table with a BLOB column                                                                                                                                                                        |
| **Performance**       | Excellent for our scale. 10K vectors × 1536 dims ≈ 60 MB. Brute-force cosine over 10K vectors completes in ~5–15 ms in JS (Float32Array). Benchmarks confirm brute-force is competitive with ANN indexes up to ~50K vectors |
| **Semantic search**   | Yes — via `embed()` from Vercel AI SDK against user's configured LLM endpoint                                                                                                                                               |
| **Full-text search**  | SQLite's built-in FTS5 virtual table for keyword/tag search                                                                                                                                                                 |
| **Relationships**     | Simple foreign keys or a join table (`memo_links`) in SQLite                                                                                                                                                                |
| **DevOps**            | Zero — same DB file, same backup, same migration pipeline                                                                                                                                                                   |
| **Deployment impact** | None — no new containers, no new services                                                                                                                                                                                   |
| **Testing**           | In-memory SQLite like today, no mocks needed                                                                                                                                                                                |
| **Risks**             | Brute-force won't scale past ~50K-100K vectors gracefully. Embedding API calls cost money per memo save                                                                                                                     |

### Option B: sqlite-vec extension

`sqlite-vec` (7.2K GitHub stars, Apache-2.0) adds `vec0` virtual tables to SQLite with native vector operations in C.

| Aspect                | Assessment                                                                                                                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New dependencies**  | `sqlite-vec` npm package                                                                                                                                                                                                                                                                                  |
| **Simplicity**        | Moderate. Requires `db.loadExtension()` which has **platform-specific issues on Bun**                                                                                                                                                                                                                     |
| **Bun compatibility** | **Problematic.** macOS's Apple-built SQLite disables extension loading. Bun requires `Database.setCustomSQLite()` to load a custom SQLite build before extensions work. This is supported on macOS but the Linux PR is still open (oven-sh/bun#22434, since Sep 2025). The Docker image uses Alpine Linux |
| **Performance**       | Faster than brute-force for large datasets using native C SIMD operations. Overkill for our scale                                                                                                                                                                                                         |
| **Semantic search**   | Yes — stores and queries vectors natively in SQL                                                                                                                                                                                                                                                          |
| **Full-text search**  | Combine with FTS5 (separate concern)                                                                                                                                                                                                                                                                      |
| **Relationships**     | Same as Option A — regular SQL                                                                                                                                                                                                                                                                            |
| **DevOps**            | Must ship the `.so`/`.dylib` binary in the Docker image                                                                                                                                                                                                                                                   |
| **Testing**           | Extension loading in tests adds friction                                                                                                                                                                                                                                                                  |
| **Risks**             | Pre-v1 (breaking changes expected). Bun extension loading on Linux is unresolved. Adds native binary dependency to an otherwise pure-TS project                                                                                                                                                           |

### Option C: sqlite-vector (SQLite.ai)

`sqlite-vector` (780 stars, proprietary license) — a newer, SIMD-accelerated alternative from SQLite Cloud.

| Aspect                        | Assessment                                                         |
| ----------------------------- | ------------------------------------------------------------------ |
| **Stars / maturity**          | 780 stars, 49 releases. Young project                              |
| **License**                   | **Not Apache/MIT** — "Other (NOASSERTION)". Risky for OSS projects |
| **Bun compatibility**         | Same `loadExtension` issues as sqlite-vec                          |
| **Advantage over sqlite-vec** | Claims faster performance, smaller memory (30 MB default)          |
| **Verdict**                   | License concern + same Bun extension issues = not recommended      |

---

## Category 2: Embedded Vector Databases (in-process, no server)

### Option D: LanceDB

Serverless, embedded vector database. Native bindings for Node.js/Bun. 333K weekly npm downloads.

| Aspect                   | Assessment                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| **npm package**          | `@lancedb/lancedb` — 333K weekly downloads, 217 dependents                                             |
| **GitHub stars**         | ~8K (lancedb/lancedb repo)                                                                             |
| **Architecture**         | Embedded, stores data as Lance columnar files on local filesystem                                      |
| **Language**             | Rust core with Node.js native bindings                                                                 |
| **Bun compatibility**    | Uses native bindings (napi). Generally works with Bun but may have edge cases                          |
| **Simplicity**           | Moderate — new storage format alongside SQLite, separate API for vector ops                            |
| **Performance**          | Excellent. Built for production-scale ANN search with IVF-PQ indexes                                   |
| **Semantic + full-text** | Supports both vector search and (since recent versions) full-text search                               |
| **Relationships**        | No built-in graph/relationship support — flat document store                                           |
| **DevOps**               | No server needed, but adds ~20-30 MB native binary to Docker image. Separate data directory to back up |
| **Testing**              | Needs filesystem-based temp dirs for test indexes                                                      |
| **Risks**                | Two data stores to manage (SQLite for core + Lance for vectors). Native binary size                    |

### Option E: Vectra

Local, file-backed vector database for Node.js. 590 stars, MIT licensed.

| Aspect                | Assessment                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **npm package**       | `vectra` — 24.6K weekly downloads, 82 dependents                                                                                                                                               |
| **GitHub stars**      | 590                                                                                                                                                                                            |
| **Architecture**      | Pure JS. Stores vectors as JSON files on disk. In-memory at query time                                                                                                                         |
| **Bun compatibility** | Pure JS — works everywhere                                                                                                                                                                     |
| **Simplicity**        | Very simple. `LocalIndex` with `insertItem` / `queryItems`                                                                                                                                     |
| **Performance**       | Fine for small datasets. JSON-based storage is inefficient for large vector sets                                                                                                               |
| **Semantic search**   | Yes — cosine similarity search built-in                                                                                                                                                        |
| **Full-text search**  | No — vector-only                                                                                                                                                                               |
| **Relationships**     | No                                                                                                                                                                                             |
| **DevOps**            | File-based, easy to back up alongside SQLite                                                                                                                                                   |
| **Risks**             | Small community. JSON storage doesn't scale well. No compression or ANN indexing. Essentially just wraps brute-force cosine in a nice API — we can trivially do the same with 50 lines of code |

### Option F: Orama

TypeScript full-text + vector + hybrid search engine. 10.2K stars, 385K weekly downloads.

| Aspect                   | Assessment                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **npm package**          | `@orama/orama` — 385K weekly downloads                                                                                                                |
| **GitHub stars**         | 10.2K                                                                                                                                                 |
| **Architecture**         | Pure TypeScript, in-memory, works in browser/Node.js/Bun                                                                                              |
| **Bun compatibility**    | Excellent — pure TS, no native deps                                                                                                                   |
| **Simplicity**           | Moderate. Full-featured search engine with schemas, facets, filters                                                                                   |
| **Performance**          | Excellent for in-memory search. Optimized for speed                                                                                                   |
| **Semantic + full-text** | Both — hybrid search combining vectors + BM25 text search in one query                                                                                |
| **Relationships**        | No native graph support                                                                                                                               |
| **DevOps**               | Zero native deps, but need persistence strategy (serialize/deserialize index to/from disk)                                                            |
| **Risk**                 | In-memory only by default — must manually persist index. Heavy for just "memo search". Index must be rebuilt from DB on startup. Adds ~50KB to bundle |

---

## Category 3: External Vector Database Services (require a server)

### Option G: Qdrant (self-hosted)

Leading open-source vector search engine. Rust-based, Docker-ready.

| Aspect                   | Assessment                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **GitHub stars**         | 25K+                                                                                                              |
| **npm client**           | `@qdrant/js-client-rest` — 353K weekly downloads                                                                  |
| **Architecture**         | Standalone server, REST/gRPC API. Docker image available                                                          |
| **Performance**          | Production-grade. HNSW indexes, binary quantization, filtering                                                    |
| **Semantic + full-text** | Dense + sparse vector search, native hybrid search (BM25 + vectors)                                               |
| **Relationships**        | Payload filtering, but no graph queries. Can link by metadata                                                     |
| **DevOps**               | **Adds a new Docker container** to `docker-compose.yml`. Needs its own volume, health checks, resource allocation |
| **Complexity**           | Significant — new service dependency, network calls, error handling for service unavailability                    |
| **When it makes sense**  | Multi-million vector datasets, multi-tenant production, when you need sub-millisecond ANN search at scale         |
| **Verdict**              | **Massive overkill** for a personal memo store with hundreds of notes. Same applies to Milvus, Weaviate, Pinecone |

### Option H: ChromaDB (self-hosted)

Open-source embedding database. Python-based server with JS client.

| Aspect           | Assessment                                                             |
| ---------------- | ---------------------------------------------------------------------- |
| **GitHub stars** | ~15K                                                                   |
| **npm client**   | `chromadb` — 172K weekly downloads                                     |
| **Architecture** | Python server (requires `chroma run` or Docker), REST client           |
| **Simplicity**   | Client is simple, but requires running a separate Python service       |
| **DevOps**       | Another Docker container. Python ecosystem dependency                  |
| **Verdict**      | Same "adds a server" problem as Qdrant, less performant. Also overkill |

---

## Category 4: AI Memory Frameworks (purpose-built for agent memory)

### Option I: Mem0

"Universal memory layer for AI Agents." 50K+ GitHub stars, $24M funding (YC).

| Aspect                       | Assessment                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub stars**             | 50K+                                                                                                                                                                                                      |
| **Architecture**             | Cloud API (Mem0 Platform) or self-hosted (Python server + Qdrant + optional Neo4j for graph memory)                                                                                                       |
| **TypeScript support**       | `mem0-ts` package exists but bundles all providers (sqlite3, pg, etc.) — breaks serverless. Community fork `@mem0-community/core` is lighter                                                              |
| **Graph memory**             | Yes — optional Neo4j/FalkorDB integration for entity-relationship extraction                                                                                                                              |
| **Self-hosted requirements** | Docker + Qdrant + OpenAI API key + optionally Neo4j. Heavy stack                                                                                                                                          |
| **Cloud tier**               | $5 free credits, then paid. Data on their servers                                                                                                                                                         |
| **Relevance**                | Designed for multi-agent systems with shared memory across sessions. Feature-rich but architecturally heavy                                                                                               |
| **Verdict**                  | Conceptually excellent, but self-hosting requires Qdrant + Neo4j + Python — 3 new containers. The cloud option sends user data externally. The TypeScript SDK is immature. **Too heavy for our use case** |

### Option J: Zep / Graphiti

Temporal knowledge graph engine for AI agents. ~24K GitHub stars.

| Aspect             | Assessment                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------- |
| **Architecture**   | Temporal knowledge graph — every memory has a timestamp and relationships are first-class |
| **Self-hosted**    | Requires Neo4j + Python server                                                            |
| **Strengths**      | Excellent at "who said what, when" queries. Time-aware retrieval                          |
| **TypeScript SDK** | Exists but thin wrapper over REST API                                                     |
| **Verdict**        | Impressive tech, but **requires Neo4j** — another heavy service for a personal memo bot   |

### Option K: OMEGA

Local-first memory MCP server. 44 stars, very new (Feb 2026).

| Aspect                | Assessment                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Architecture**      | SQLite + local ONNX embeddings (no cloud API needed for embeddings)                                               |
| **Language**          | Python only                                                                                                       |
| **Strengths**         | Zero cloud dependency. ONNX models for local embeddings                                                           |
| **Interesting ideas** | Memory decay, contradiction detection, cross-session learning                                                     |
| **Verdict**           | Python-only, designed for MCP protocol, not a library we can embed. But **validates the SQLite + local approach** |

---

## Category 5: Graph Databases (for relationship modeling)

### Option L: FalkorDB Lite (embedded)

Embedded graph database for TypeScript. Runs embedded Redis with graph module.

| Aspect           | Assessment                                                                     |
| ---------------- | ------------------------------------------------------------------------------ |
| **npm package**  | `falkordblite` — v0.2.0                                                        |
| **Architecture** | Embedded redis-server + FalkorDB module. Zero-config                           |
| **Platform**     | Linux x64 + macOS arm64 only. No Windows                                       |
| **Maturity**     | 5 GitHub stars, created Feb 2026. Very early                                   |
| **Verdict**      | Interesting concept but too immature. Bundles an embedded Redis which is heavy |

### Option M: Kuzu (embedded graph DB)

Embedded property graph database. 3.8K stars, Cypher query language.

| Aspect           | Assessment                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **npm package**  | `kuzu` v0.11.3                                                                                                                                |
| **Architecture** | Embedded C++ engine with Node.js bindings. On-disk or in-memory                                                                               |
| **Maturity**     | 3.8K stars, backed by university research team. Used by Microsoft, Nvidia, JPMorgan                                                           |
| **NOTE**         | **Being archived.** The project is transitioning to an enterprise model. Existing releases remain usable, but future development is uncertain |
| **Verdict**      | Being archived makes this a no-go for new projects                                                                                            |

### Option N: Graphology (in-memory JS graph)

Pure JavaScript graph library. 1.6K stars, 747K weekly downloads.

| Aspect           | Assessment                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Architecture** | Pure JS in-memory graph data structure with algorithms library                                                   |
| **Strengths**    | Lightweight, no native deps, excellent API. Traversals, shortest paths, centrality, etc.                         |
| **Persistence**  | None built-in — must serialize/deserialize manually                                                              |
| **Verdict**      | Could model memo relationships in memory, but adds complexity for a problem SQLite join tables solve more simply |

### Option O: SQLite as a graph (adjacency table)

Model relationships with a simple `memo_links` table:

```sql
CREATE TABLE memo_links (
  source_memo_id TEXT NOT NULL,
  target_memo_id TEXT,
  target_task_id TEXT,
  relation_type TEXT NOT NULL,  -- 'related_to', 'derived_from', 'contradicts', etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

| Aspect               | Assessment                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| **New dependencies** | Zero                                                                                                        |
| **Simplicity**       | Trivial — just another Drizzle table                                                                        |
| **Query complexity** | Simple JOINs for direct relationships. Recursive CTEs for multi-hop traversal (SQLite supports them)        |
| **Performance**      | Excellent for our scale. Graph databases shine at millions of nodes; we have hundreds                       |
| **Verdict**          | **Best fit.** At our scale, SQLite adjacency tables + recursive CTEs cover every relationship query we need |

---

## Comparison Matrix

| Solution                    | New Deps  | New Services | Bun Compat                  | Semantic Search | Full-Text   | Relationships | Complexity | Fits Scale |
| --------------------------- | --------- | ------------ | --------------------------- | --------------- | ----------- | ------------- | ---------- | ---------- |
| **A: SQLite + brute-force** | 0         | 0            | ✅ Native                   | ✅ via AI SDK   | ✅ FTS5     | ✅ SQL joins  | Very Low   | ✅         |
| B: sqlite-vec               | 1 native  | 0            | ⚠️ Extension loading issues | ✅ Native SQL   | ✅ FTS5     | ✅ SQL joins  | Medium     | ✅         |
| C: sqlite-vector            | 1 native  | 0            | ⚠️ Extension loading issues | ✅ Native SQL   | ✅ FTS5     | ✅ SQL joins  | Medium     | ✅         |
| D: LanceDB                  | 1 native  | 0            | ⚠️ napi edge cases          | ✅ Built-in     | ✅ Built-in | ❌            | Medium     | ✅         |
| E: Vectra                   | 1 pure JS | 0            | ✅ Pure JS                  | ✅ Built-in     | ❌          | ❌            | Low        | ✅         |
| F: Orama                    | 1 pure TS | 0            | ✅ Pure TS                  | ✅ Built-in     | ✅ Built-in | ❌            | Medium     | ✅         |
| G: Qdrant                   | 1 client  | 1 Docker     | ✅                          | ✅ Built-in     | ✅ Built-in | ⚠️ Metadata   | High       | Overkill   |
| H: ChromaDB                 | 1 client  | 1 Docker     | ✅                          | ✅ Built-in     | ✅ Built-in | ❌            | High       | Overkill   |
| I: Mem0 self-hosted         | 2+        | 2-3 Docker   | ⚠️ Immature TS SDK          | ✅              | ✅          | ✅ Graph      | Very High  | Overkill   |
| J: Zep/Graphiti             | 1 client  | 2 Docker     | ✅                          | ✅              | ✅          | ✅ Temporal   | Very High  | Overkill   |

---

## Embedding Strategy (applies to any storage choice)

Semantic search requires vector embeddings. Two approaches:

### Remote embeddings (via user's LLM endpoint)

Use Vercel AI SDK's `embed()` / `embedMany()` against the user's configured OpenAI-compatible API.

- **Pro:** Zero additional dependencies. Uses the AI SDK already in the project. High-quality embeddings (e.g., `text-embedding-3-small` at 1536 dims)
- **Pro:** The user already pays for and configures an LLM endpoint
- **Con:** Costs per API call (but embedding API calls are cheap — ~$0.02 per 1M tokens)
- **Con:** Requires network. No offline embedding
- **Con:** Not all OpenAI-compatible endpoints expose embedding models

### Local ONNX embeddings

Run a small model locally (e.g., `all-MiniLM-L6-v2` at 384 dims). Used by OMEGA and others.

- **Pro:** Free, offline, no API dependency
- **Con:** Adds ~80-100 MB model files to the deployment
- **Con:** Requires ONNX runtime npm package (native dependency)
- **Con:** Lower quality embeddings than cloud models
- **Con:** Bun ONNX compatibility is not well-tested

### Recommendation

**Remote embeddings via Vercel AI SDK** — aligns with the project's existing architecture where the LLM provider is user-configured. If the user's endpoint supports embeddings, we use it. If not, we gracefully fall back to keyword-only search (FTS5) — semantic recall becomes a best-effort feature that works when embeddings are available.

---

## Recommendation: Option A — SQLite + Vercel AI SDK brute-force

### Why

1. **Zero new dependencies.** We already have `bun:sqlite`, Drizzle ORM, and the Vercel AI SDK with `embed()` + `cosineSimilarity()`.

2. **Proven at our scale.** Brute-force cosine similarity over 10K vectors takes ~5-15ms in JavaScript. Benchmarks consistently show brute-force matches or beats ANN indexes below ~50K vectors. We will never realistically hit that number.

3. **No Bun compatibility issues.** Native `bun:sqlite` works perfectly. No extension loading, no native bindings, no ONNX runtime.

4. **Single data store.** Memos, embeddings, tags, relationships, and tasks all live in one `papai.db` file. One backup strategy, one migration pipeline, one Drizzle schema.

5. **Full-text + semantic search.** SQLite FTS5 for keyword/tag matching, brute-force cosine for semantic recall. Both well-understood, battle-tested.

6. **Relationships via SQL.** A `memo_links` adjacency table with recursive CTEs covers all relationship queries at our scale. No graph database needed.

7. **Docker image stays lean.** No new containers, no new volumes, no new healthchecks.

8. **Graceful degradation.** If the user's LLM endpoint doesn't support embeddings, memos still work — just without semantic recall. FTS5 keyword search is the always-available fallback.

### Proposed schema

```sql
-- Memos table
CREATE TABLE memos (
  id TEXT PRIMARY KEY,           -- ULID
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,                   -- LLM-generated one-liner
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array
  embedding BLOB,                 -- Float32Array as BLOB (nullable)
  status TEXT NOT NULL DEFAULT 'active', -- active | archived
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE memos_fts USING fts5(content, summary, tags, content='memos', content_rowid='rowid');

-- Relationship links (memo↔memo, memo↔task)
CREATE TABLE memo_links (
  id TEXT PRIMARY KEY,
  source_memo_id TEXT NOT NULL REFERENCES memos(id),
  target_memo_id TEXT REFERENCES memos(id),
  target_task_id TEXT,            -- external task reference
  relation_type TEXT NOT NULL,    -- 'related_to', 'derived_from', 'supersedes', 'action_for'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Search strategy

1. **Tag search:** `WHERE json_each(tags) = ?` — exact tag match
2. **Keyword search:** FTS5 `MATCH` query — fast full-text search
3. **Semantic search:** Load all user's embeddings, compute `cosineSimilarity()` against query embedding, return top-N. Falls back to FTS5 if embedding unavailable
4. **Relationship traversal:** JOIN on `memo_links` + recursive CTE for multi-hop

### When to reconsider

- If memo count per user exceeds ~50K → consider sqlite-vec (if Bun extension loading is resolved by then)
- If multi-user deployment hits ~100+ concurrent users → consider Qdrant
- If complex graph queries become common → consider a lightweight graph layer

---

## Solutions explicitly NOT recommended

| Solution                                  | Reason                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Qdrant / Milvus / Weaviate / Pinecone** | Adds Docker containers or cloud dependency for a problem that brute-force solves in 10ms                                                      |
| **ChromaDB**                              | Adds a Python service. No advantage over SQLite at our scale                                                                                  |
| **Mem0 self-hosted**                      | Requires Qdrant + Neo4j + Python. Three new services for a single-user memo store                                                             |
| **Mem0 cloud**                            | Sends personal user data to a 3rd party. Privacy concern for a personal assistant                                                             |
| **Zep/Graphiti**                          | Requires Neo4j. Temporal knowledge graph is overkill for simple memos                                                                         |
| **Kuzu**                                  | Being archived. Future uncertain                                                                                                              |
| **FalkorDB Lite**                         | 5 GitHub stars, very immature, bundles Redis                                                                                                  |
| **sqlite-vec**                            | Would be great if Bun extension loading worked reliably. Revisit when v1.0 ships and Bun's Linux dynamic SQLite PR merges                     |
| **Orama**                                 | Good library but adds in-memory index management complexity. Must rebuild on startup, persist on shutdown. SQLite is simpler for our use case |
| **LanceDB**                               | Solid embedded DB but introduces a second data store alongside SQLite. Unnecessary when brute-force covers our needs                          |
