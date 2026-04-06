# GraphQL Task API Middleware — Design Document

Status: Draft / RFC
Author: Claude (research + design)
Branch: `claude/graphql-task-api-middleware-sWwTN`

## 1. Problem

Today the LLM has ~25 fine-grained task tools (`src/tools/index.ts:54-200`) and the read side is severely limited:

- `search_tasks` only accepts `{ query, projectId?, limit? }` — free-text only.
- `list_tasks` only accepts `{ projectId }` — returns every task in a project.
- There is no way to ask "open high-priority tasks assigned to me, due this week, in projects A or B, with their last comment".

To answer such a question the bot has to: `list_projects` → `list_tasks` (per project) → in-memory filter → `get_task` (per id, for relations/labels) → `get_comments` (per id). That is N+1+M tool calls per question, blows the 25-step `stopWhen` budget, wastes tokens, and is slow.

The asymmetry between providers makes this worse:

| Filter | Kaneo native | YouTrack native |
|---|---|---|
| project | ✓ query param | ✓ query DSL |
| text | ✓ `q` | ✓ free text |
| status | ✗ | ✓ `State:` |
| priority | ✗ | ✓ `Priority:` |
| assignee | ✗ | ✓ `Assignee:` |
| labels/tags | ✗ | ✓ `tag:` |
| due / created date | ✗ | ✓ date ranges |

YouTrack's `/api/issues?query=…` accepts a powerful issue-query DSL that the current code only uses for `project: {id}` (`src/providers/youtrack/operations/tasks.ts:124`). Kaneo only supports project-scoped listing.

## 2. Goal

Introduce a GraphQL middleware layer that:

1. Lets the LLM express **compositional read queries** in one round-trip with selected fields.
2. Pushes filters down to the provider when natively supported (YouTrack DSL), and falls back to in-memory filtering when not (Kaneo).
3. Replaces the read-side tool sprawl with **one** `query_tasks` tool (and one optional `describe_schema` introspection helper), reducing the tool surface from ~25 to ~12.
4. Leaves **mutations as typed JSON tools** — they are safer, auditable, and capability-gated per `src/tools/CLAUDE.md`.

Non-goals: replacing mutations with GraphQL mutations; building a public GraphQL endpoint; persisted-query infrastructure (future work).

## 3. Research summary — does the LLM handle GraphQL?

Sources: EMNLP 2024 "GraphQL Query Generation" benchmark, IBM IJCAI 2024 "LLM-powered GraphQL Generator", Cato Networks production case study (ZenML LLMOps DB), Weaviate Gorilla, Apollo MCP Server 1.0 docs, Hasura PromptQL.

Key findings:

- **Reads are tractable, mutations are not.** GPT-4-class and Claude can write valid read queries against a small, well-described SDL ~70-90% zero-shot, lifted into the 90s with few-shot examples and a parse+validate+retry loop. Mutations regress sharply — input object shapes are deeper, less self-describing, and a hallucinated field on a mutation has destructive consequences.
- **SDL beats JSON introspection** (3-5x token savings, more training data).
- **Schema pruning is the #1 accuracy lever** (Cato). Keep the schema small.
- **Enums beat free strings** for `status`, `priority`, `relationType` — eliminates a whole class of hallucinations because the LLM enumerates inline from SDL.
- **Flat filter inputs beat nested AND/OR trees** (Hasura-style nesting is a top failure source).
- **Field descriptions matter** — `"""docstrings"""` are treated as natural-language hints.
- **`graphql-js` parse + validate + retry-once** with the validation errors fed back catches ~80% of remaining errors cheaply.
- **Apollo MCP** (the most mature production pattern) defaults to *curated operation files* rather than full-schema exposure; full introspection mode is opt-in.

Conclusion: a small, hand-curated, flat, enum-rich SDL exposed to the LLM as one tool with a few-shot description and a validate-retry loop is reliable enough for the read side. Mutations stay as typed tools.

## 4. Proposed architecture

```
LLM ─→ query_tasks(graphql, variables)
            │
            ▼
       graphql-js execute
            │
            ▼
    Resolver layer  ─────────────────┐
            │                        │
            ├─ pushdown planner      │
            │   ├─ YouTrack: build    │
            │   │   issue-query DSL   │
            │   └─ Kaneo:  list+      │
            │       in-memory filter  │
            ▼                        │
    TaskProvider (existing) ─────────┘
            │
            ▼
    Kaneo / YouTrack REST
```

The middleware is **in-process** (`graphql` npm package). No network hop, no schema served externally. The resolvers call the *existing* `TaskProvider` interface — providers are unchanged on day 1.

### 4.1 Schema (initial draft)

```graphql
"""A task / issue, normalized across providers."""
type Task {
  id: ID!
  number: Int
  title: String!
  description: String
  status: String
  priority: Priority
  assignee: String
  dueDate: String
  createdAt: String
  projectId: ID
  url: String!
  labels: [Label!]!
  relations: [TaskRelation!]!
  comments(limit: Int = 20): [Comment!]!
}

enum Priority { NO_PRIORITY LOW MEDIUM HIGH URGENT }
enum RelationType { BLOCKS BLOCKED_BY DUPLICATE DUPLICATE_OF RELATED PARENT }
enum SortField { CREATED_AT DUE_DATE PRIORITY }
enum SortOrder { ASC DESC }

type Label    { id: ID! name: String! color: String }
type Project  { id: ID! name: String! description: String url: String! }
type Comment  { id: ID! body: String! author: String createdAt: String }
type TaskRelation { type: RelationType! taskId: ID! }

"""Flat filter input. All fields are AND-combined; list fields are OR within."""
input TaskFilter {
  text:        String           # free-text search
  projectIds:  [ID!]
  statusIn:    [String!]
  priorityIn:  [Priority!]
  assigneeIn:  [String!]
  labelIn:     [String!]
  dueBefore:   String           # ISO date
  dueAfter:    String
  createdAfter: String
  hasDueDate:  Boolean
}

type Query {
  tasks(
    filter: TaskFilter
    sort: SortField = CREATED_AT
    order: SortOrder = DESC
    limit: Int = 50
  ): [Task!]!

  task(id: ID!): Task

  projects: [Project!]!
  labels: [Label!]!
  statuses(projectId: ID!): [String!]!
}
```

Notes:

- **Flat `TaskFilter`** by design (research finding §3).
- **Enums for `Priority` / `RelationType`** are reused from `src/providers/types.ts:46-123`.
- `comments` is a sub-field on `Task`, not a separate root — kills the N+1 chain.
- No mutations in the schema. Mutations stay as typed tools.

### 4.2 Resolver pushdown

```
src/graphql/
  schema.ts            # SDL string + buildSchema()
  resolvers.ts         # Query.tasks, Query.task, Task.comments, …
  pushdown/
    youtrack.ts        # TaskFilter → YouTrack issue-query DSL
    kaneo.ts           # TaskFilter → { projectId, q } + in-memory predicate
  validate.ts          # parse + validate, returns errors as strings
  execute.ts           # graphql() wrapper used by the tool
```

`pushdown/youtrack.ts` translates `TaskFilter` into the existing query-string DSL. For example:

```ts
{ statusIn: ['Open','In Progress'], priorityIn: ['HIGH','URGENT'], assigneeIn: ['me'] }
// → "State: Open, {In Progress} Priority: High, Critical Assignee: me"
```

It then calls `provider.searchTasks({ query: dsl, projectId, limit })` — the existing path at `src/providers/youtrack/operations/tasks.ts:116-144`, which already accepts a free-form query string. **No new provider method needed for YouTrack pushdown on day 1.**

`pushdown/kaneo.ts` calls `provider.listTasks(projectId)` for each project in `projectIds` (or all projects), then applies a JS predicate. This is no worse than what the LLM already does manually today, and it is now hidden behind a single GraphQL call.

Phase 2 (optional) extends `TaskProvider` with a richer `queryTasks(filter)` so Kaneo can implement server-side filtering when it adds the capability — fully transparent to the LLM.

### 4.3 The `query_tasks` tool

```ts
// src/tools/query-tasks.ts
tool({
  description: `Run a GraphQL read query against the task tracker.

SCHEMA:
<<inlined SDL — ~80 lines>>

EXAMPLES:
1. "open high-priority tasks assigned to me"
   query { tasks(filter:{ statusIn:["Open"], priorityIn:[HIGH,URGENT], assigneeIn:["me"] }) { id title url priority dueDate } }

2. "everything about TASK-42 including last 5 comments and relations"
   query { task(id:"TASK-42") { title description status priority assignee dueDate labels{name} relations{type taskId} comments(limit:5){author body createdAt} } }

3. "all tasks due this week in project ACME"
   query { tasks(filter:{ projectIds:["ACME"], dueAfter:"2026-04-06", dueBefore:"2026-04-13" }) { id title dueDate } }

4. "list projects and their open task counts" — fetch projects and filter per id.

Rules:
- Use only fields in the schema. Do not invent fields.
- Prefer narrow selection sets; ask for only the fields you need.
- One query per call. No mutations.`,
  inputSchema: z.object({
    query: z.string(),
    variables: z.record(z.string(), z.unknown()).optional(),
  }),
  execute: async ({ query, variables }) => {
    const errs = validateGraphQL(query)
    if (errs.length) return { error: 'GraphQL validation failed', details: errs }
    return await executeGraphQL(query, variables, { provider, userId })
  },
})
```

The validation step uses `graphql-js` `parse()` + `validate(schema, ast)`. On error the tool returns a structured error to the LLM, which retries — the orchestrator's existing 25-step budget covers a one-shot retry. No bespoke retry loop needed in the tool itself.

Optional companion tool `describe_schema(typeName?)` returns the SDL of one type — useful for very large schemas, probably unnecessary at our size but cheap to add.

## 5. Tool surface reduction

Tools removed (replaced by `query_tasks`):

| Removed | Why |
|---|---|
| `search_tasks` | `tasks(filter:{text})` |
| `list_tasks` | `tasks(filter:{projectIds:[…]})` |
| `get_task` | `task(id)` |
| `list_projects` | `projects` |
| `list_labels` | `labels` |
| `list_statuses` | `statuses(projectId)` |
| `get_comments` | `task(id){comments}` sub-field |

That is **7 tools removed**, plus the implicit removal of N+1 chains. Tools kept (mutations + introspection):

- `query_tasks`, `describe_schema` *(new)*
- `create_task`, `update_task`, `delete_task` *(unchanged, capability-gated)*
- `add_comment`, `update_comment`, `remove_comment`
- `create_project`, `update_project`, `archive_project`
- `create_label`, `update_label`, `remove_label`, `add_task_label`, `remove_task_label`
- `add_task_relation`, `update_task_relation`, `remove_task_relation`
- `create_status`, `update_status`, `delete_status`, `reorder_statuses`

Net: ~25 → ~22 tools, but the *frequently-invoked* read tools collapse to one, which is the main token-budget and round-trip win.

**Verification of "does GraphQL allow getting rid of a lot of tools": yes for reads (7 tools collapse to 1 plus full filter composability), no for writes** — and the research is unambiguous that we should not try.

## 6. Code changes required

1. **New dependency**: `graphql` (~600KB, well-maintained, no transitive deps). Add to `package.json`.
2. **New module `src/graphql/`** as laid out in §4.2. ~500 LOC including resolvers.
3. **New tool `src/tools/query-tasks.ts`** + optional `describe-schema.ts`.
4. **`src/tools/index.ts`**: in `makeCoreTools`, replace `search_tasks` / `list_tasks` / `get_task` with `query_tasks`. In the capability-gated sections, drop `list_projects`, `list_labels`, `list_statuses`, `get_comments` — but keep their *capabilities* checks so the schema resolvers can refuse fields when the active provider lacks the capability.
5. **Resolver capability gating**: each resolver checks `provider.capabilities.has('comments.read')` etc. and throws a GraphQL error if the field is unsupported. The schema is the same across providers; capability errors are reported in `errors[]` so the LLM can adapt.
6. **System prompt update** (`src/prompts/`): add a brief note "use `query_tasks` for any read; it accepts a GraphQL query — see its tool description for the schema and examples".
7. **No changes to providers on day 1.** YouTrack pushdown reuses `searchTasks`'s existing query-string parameter; Kaneo uses `listTasks` + JS filter.
8. **Tests** (per `tests/CLAUDE.md`):
   - `tests/graphql/validate.test.ts` — schema parses; rejects unknown fields.
   - `tests/graphql/pushdown/youtrack.test.ts` — filter → DSL string snapshots.
   - `tests/graphql/pushdown/kaneo.test.ts` — filter → in-memory predicate.
   - `tests/graphql/resolvers.test.ts` — full execution against `MockTaskProvider`.
   - `tests/tools/query-tasks.test.ts` — tool wraps execute and surfaces validation errors.
   - E2E: extend existing Kaneo E2E with one GraphQL query.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| LLM writes invalid GraphQL | parse+validate, return structured errors, LLM retries within step budget |
| LLM hallucinates fields | minimal schema; enums; descriptions; few-shot in tool description |
| Token cost of inlining SDL | SDL is ~80 lines / ~1.5k tokens; cheaper than 7 tool definitions today |
| Kaneo in-memory filtering on huge projects | document the limitation; phase 2 adds `provider.queryTasks` for server pushdown |
| YouTrack DSL escaping bugs | translate via a small allow-listed builder, never string-concat user text; cover with snapshot tests |
| Capability variance across providers | resolvers throw typed GraphQL errors; LLM handles gracefully |
| Mutation safety regression | **non-issue** — mutations stay as typed tools; this is an explicit design constraint |

## 8. Rollout plan

1. **Phase 1 — additive**: ship `query_tasks` alongside the existing read tools behind a feature flag (env var `GRAPHQL_TOOL=1`). Run both for a release; observe reliability via the existing debug dashboard tool-call telemetry (`src/debug/`).
2. **Phase 2 — cutover**: remove the seven legacy read tools; update system prompt; bump CHANGELOG with an automatic announcement (`src/announcements.ts`).
3. **Phase 3 — provider pushdown**: extend `TaskProvider` with optional `queryTasks(filter)`; implement for Kaneo if/when its API supports it. Transparent to the LLM.
4. **Phase 4 (optional)** — `describe_schema` introspection tool, persisted operations à la Apollo MCP if reliability issues appear at scale.

## 9. Open questions

- Do we want a `count` field (`tasks(filter){…}` returning a connection with `totalCount`)? Useful for "how many open tasks?" without fetching them. Low cost to add.
- Should `assigneeIn: ["me"]` resolve `me` server-side from the chat user? Probably yes — convenient and avoids the LLM having to know the username.
- Pagination: do we need cursor pagination, or is `limit` enough? Limit is enough for chatbot UX; defer cursors.

## 10. References

- EMNLP 2024 — GraphQL Query Generation benchmark: https://aclanthology.org/2024.emnlp-industry.117.pdf
- IBM IJCAI 2024 — LLM-powered GraphQL Generator: https://www.ijcai.org/proceedings/2024/1002.pdf
- Cato Networks NL→GraphQL case study: https://www.zenml.io/llmops-database/converting-natural-language-to-structured-graphql-queries-using-llms
- Weaviate Gorilla: https://weaviate.io/blog/weaviate-gorilla-part-1
- Apollo MCP Server: https://www.apollographql.com/docs/apollo-mcp-server
- Apollo "Building MCP Tools with GraphQL": https://www.apollographql.com/blog/building-mcp-tools-with-graphql-a-better-way-to-connect-llms-to-your-api
