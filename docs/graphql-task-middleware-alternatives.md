# Alternatives to GraphQL — Survey

Status: Research addendum to `graphql-task-middleware-design.md`
Branch: `claude/graphql-task-api-middleware-sWwTN`

## Why this addendum

The GraphQL design solves both problems (tool sprawl + LLM-driven filtering) but it brings a parser, an executor, a query language, and a validate-retry loop into the bot. This document surveys non-GraphQL options against the same goals so the choice is informed.

Goals (recap):

- **G1.** Reduce tool surface — today ~25 tools, the read side dominates accidental complexity.
- **G2.** Move filtering from LLM-orchestrated tool chains into deterministic code, so questions like "open high-priority tasks assigned to me with their last comment" become one round-trip.
- **G3.** Keep mutations as typed JSON tools (capability-gated, auditable — `src/tools/CLAUDE.md`).
- **G4.** Stay portable across providers with very different filter capability (YouTrack DSL vs Kaneo project-only listing).

## Approaches considered

### A. Rich structured-JSON filter tool (typed Zod)

One `query_tasks` tool whose Zod input is a flat filter:

```ts
{
  text?: string
  projectIds?: string[]
  statusIn?: string[]
  priorityIn?: ('no-priority'|'low'|'medium'|'high'|'urgent')[]
  assigneeIn?: string[]   // 'me' resolved server-side
  labelIn?: string[]
  dueBefore?: string; dueAfter?: string
  createdAfter?: string
  hasDueDate?: boolean
  sort?: 'createdAt'|'dueDate'|'priority'
  order?: 'asc'|'desc'
  limit?: number
  fields?: ('description'|'labels'|'relations')[]
  includeComments?: 'none'|'last'|'all'
}
```

- **Reliability:** highest of any option. OpenAI Structured Outputs and Anthropic tool-use are RLHF-trained on exactly this shape; JSON Schema *guarantees* shape conformance. Field names are self-documenting from the schema the SDK already sends to the model.
- **Tokens:** one tool definition replaces 6-7 read tools. A typical call is ~40-80 tokens vs 3-6 round-trips today.
- **Composability:** good but bounded. The example question is one call iff `includeComments:'last'` exists in the schema. Anything not pre-modeled (e.g. "tasks blocked by tasks I closed yesterday") still needs multiple calls — but those queries are rare in chatbot UX.
- **Cost:** very low. Aligns with the existing Zod-everywhere convention. ~300 LOC.
- **Where it falls down:** arbitrary boolean nesting, cross-entity joins, ad-hoc aggregations. You add fields over time as needs surface.

### B. Tool namespacing / dynamic tool loading / RAG over tools

MCP tool groups, Anthropic's Tool Search Tool, RAG-MCP (arXiv 2505.03275: tool selection 13.6% → 43.1% with retrieval). Anthropic's own benchmark: 77k tool catalog → 8.7k tokens (~85% reduction).

But: those wins are measured against catalogs of **hundreds**. Anthropic explicitly recommends Tool Search "when your agent needs access to 30 or more tools." papai has ~25, *below* the threshold. You'd pay an extra round-trip per request for marginal benefit.

Crucially this is **orthogonal to G2** — it changes which tools are visible, not how filters work. N+1 chains stay. **Defer; revisit if tool count crosses ~40 or a third provider lands.**

### C. JSONLogic / Mongo-style predicate DSL

`{"and":[{"status":{"$in":["open"]}},{"priority":"high"}]}`. Used by Linear, Notion, Sift.

- **Reliability:** worse than A. The `$in`/`$and` sigils aren't first-class in JSON Schema, so structured-output enforcement is partial — "object with `$in` key" validates, "valid Mongo expression tree" doesn't. Failure modes are silent: a typo in `$gte` becomes a semantic bug, not a schema error. Elastic's own docs note Query DSL needs few-shot examples to author reliably.
- **Token cost:** comparable for simple, worse for nested.
- **Composability:** strictly more flexible than A; still no joins.
- **Cost:** medium — write the predicate evaluator twice (translate to YouTrack DSL; interpret in-memory for Kaneo). Capability-gating individual operators is awkward.

Net: strictly dominated by A for papai's use case.

### D. JQL / YouTrack-DSL passthrough

LLM emits `"#Unresolved priority: Critical assignee: me"` directly. Reliability is surprisingly OK because YouTrack/JQL are well-represented in pretraining. **Kills G4** — Kaneo has no equivalent, forcing per-provider system prompts. Only viable as a *fallback* tool (`youtrack_raw_query`) gated on `TASK_PROVIDER=youtrack` for the long tail that A can't express.

### E. Code execution as a tool (sandboxed JS/Python)

Anthropic's Code Execution with MCP (Nov 2025): the model writes code that calls tools as functions, filters in-sandbox, returns only the answer. Anthropic's benchmark: **150k → 2k tokens (~99% reduction)** on a 20-lookup task.

- **Reliability:** strong on Claude (RLHF-tuned). Weaker on arbitrary OpenAI-compatible models — and papai's LLM is *user-configurable*, so we can't assume Claude. Vercel AI SDK doesn't yet wrap `code_execution_20260120` (vercel/ai#12794).
- **Composability:** maximum — arbitrary joins, aggregations, last-comment lookups.
- **Cost:** high. Sandbox infra, security review, prompt-injection surface (untrusted task descriptions feed into code).
- **Verdict:** overkill for ~25 tools and two providers. Skip for now; reconsider if papai standardizes on Claude.

### F. Server-side resolver behind a typed Zod filter — i.e. A with an explicit translation layer

This is option A *with* a per-provider adapter layer that translates the Zod filter to YouTrack's issue-query DSL (server-side pushdown) or to a Kaneo `listTasks` + in-memory predicate (fallback). Capability-gating per provider is natural — drop a Zod field if the provider can't honor it; the LLM never sees provider-specific syntax.

This is **the same backend** as the GraphQL plan minus the parser/executor and minus the SDL-in-prompt cost. The reduction in tools is identical. The difference is the LLM speaks JSON Schema instead of GraphQL strings.

### G. Fewer, fatter polymorphic tools — `read(entity, filter, fields)`

One read tool with a discriminated union per entity (`task`/`project`/`label`/`comment`). Anthropic's "writing tools for agents" guide explicitly recommends consolidating overlapping tools. Risk: a single tool that does everything has a less informative name and per-entity differences leak into the description. **Best applied as a refactor of read-side only**, keeping mutations as discrete typed tools so error messages and capability gating stay sharp.

## Comparison table

| Option | LLM reliability | Token cost | Composability | Impl cost | Provider portability | Mutations safe |
|---|---|---|---|---|---|---|
| **A. Typed Zod filter** | ★★★★★ | ★★★★★ | ★★★ | ★★★★★ | ★★★★ | ✓ |
| **F. = A + resolver layer** | ★★★★★ | ★★★★★ | ★★★ | ★★★★ | ★★★★★ | ✓ |
| **G. Polymorphic `read`** | ★★★★ | ★★★★ | ★★★ | ★★★★ | ★★★★ | ✓ |
| C. JSONLogic | ★★★ | ★★★★ | ★★★★ | ★★★ | ★★★ | ✓ |
| GraphQL (prior doc) | ★★★ | ★★★ | ★★★★★ | ★★ | ★★★★★ | ✓ (mut. stay typed) |
| D. DSL passthrough | ★★★★ (YT only) | ★★★★★ | ★★★★ | ★★★★★ | ★ | ✓ |
| B. Dynamic tool loading | ★★★★ | depends | n/a (orthogonal) | ★★★ | ★★★★ | ✓ |
| E. Code execution | ★★★ (model-dependent) | ★★★★★ | ★★★★★ | ★ | ★★★★ | ⚠ sandbox |

## Recommendation for papai

**Primary: Option F — typed Zod filter with a server-side per-provider resolver.**

Rationale:

1. **Higher reliability than GraphQL** — structured-output JSON Schema enforcement is stronger than GraphQL string validation, and is what every OpenAI-compatible provider has been RLHF-trained on. No parse/validate/retry loop needed.
2. **Same backend wins as GraphQL** — the resolver translates filter → YouTrack DSL (push-down) or → Kaneo `listTasks` + predicate (fallback). This is identical to §4.2 of the GraphQL doc; only the front door differs.
3. **Same tool-surface reduction** — collapses `search_tasks`, `list_tasks`, `get_task`, `get_comments`, `list_projects`, `list_labels`, `list_statuses` into one `query_tasks` plus a small `query_projects` (or fold into the same tool with `entity:` discriminator per option G).
4. **Cheaper implementation** — no `graphql` dependency, no SDL inlined in the tool description, no parser, no executor, no introspection helper. ~300 LOC vs ~500.
5. **Aligns with `src/tools/CLAUDE.md`** — every tool already uses Zod schemas; this is the natural extension, not a new paradigm in the codebase.
6. **Capability gating is natural** — fields drop out of the Zod schema (or are validated to error) when the provider lacks the capability, mirroring how tools are gated today in `src/tools/index.ts:187-192`.

**Secondary (opt-in): Option D for YouTrack power users.** Add `youtrack_raw_query` only when `TASK_PROVIDER=youtrack`, behind an env flag, for the long tail F cannot express. Costs nothing if unused.

**Defer: Option B (dynamic tool loading).** Revisit when the tool count crosses ~40 or a third provider lands.

**Skip: C, E.** Strictly dominated for papai's scale and model-portability constraints.

## What changes vs the GraphQL design doc

The architecture diagram, the file layout under `src/graphql/` → `src/query/`, the per-provider pushdown planners (`pushdown/youtrack.ts`, `pushdown/kaneo.ts`), the test plan, the rollout phases — **all reusable**. Only the front door changes:

| GraphQL design | Typed-filter design |
|---|---|
| `query_tasks(graphql: string, variables?)` | `query_tasks(filter, sort?, limit?, includeComments?, fields?)` |
| Tool description inlines ~80 lines of SDL + 4 examples | Tool description is one paragraph + Zod schema (auto-rendered by AI SDK) |
| `graphql` dep, `parse()`+`validate()`, retry loop | None — JSON Schema enforced by the model runtime |
| SDL field selection (`{ id title comments(limit:5){body} }`) | `fields: ['description','labels']`, `includeComments: 'last'` enums |
| Free composition (any boolean nesting) | Fixed flat AND-of-INs filter; long tail goes to `youtrack_raw_query` if enabled |

The GraphQL doc remains valid as a Phase-3 escape hatch *if* users start asking compositional questions the typed filter can't express. But based on the research, that day is unlikely to arrive soon, and Option F captures ~95% of the value at ~60% of the cost.

## References

- Anthropic — Writing tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic — Advanced tool use: https://www.anthropic.com/engineering/advanced-tool-use
- Anthropic — Code execution with MCP: https://www.anthropic.com/engineering/code-execution-with-mcp
- RAG-MCP: https://arxiv.org/html/2505.03275v1
- Speakeasy — 100x token reduction with dynamic toolsets: https://www.speakeasy.com/blog/100x-token-reduction-dynamic-toolsets
- Elastic — Query DSL with LLMs: https://www.elastic.co/search-labs/blog/elastic-query-dsl-structured-datasets
- vercel/ai#12794 (code execution support): https://github.com/vercel/ai/issues/12794
