# afk-runner live lane

Logs the afk-runner graph itself authored in live proof runs — real `opencode`
spawns, real gates answered through the documented surfaces, induced incidents
(kill -9 mid-review-round, extend-at-final cycle). Marking vocabulary:

| lane            | mark      | provenance                                                     |
| --------------- | --------- | -------------------------------------------------------------- |
| `../real/`      | legacy    | historical sdd-runner runs (ported with their persisted memos) |
| `../scenarios/` | synthetic | extracted/synthetic shapes, `-synthetic` filename suffix       |
| `live/`         | **live**  | authored by the afk-runner engine itself, end to end           |

## mutation-floor-hardening-live

The v1-live-proof M run (2026-08-29, free-tier `zai-coding-plan/glm-5.3`,
$0.00 spend, 20 spawns): intake misclassification drill (prescreen M floor),
draft, four review rounds (round 1 killed mid-flight at seq 195/196 and
resumed same-round via session-ledger continuation — attempt 2 reused the same
opencode session), converged tail, final gate v1 extended (`→ RUN 1 MORE`),
round 4 at raised cap, final gate v2 approved. Terminal memo `completed`.

Oracle: `inventory.test.ts` — folding the log reproduces the persisted memo
fields, and every line validates against the event schemas.

## event-driven-suggestion-payloads-live

The v2-live-proof (C8) Run A (2026-09-01, `zai-coding-plan/glm-5.3` after the
priced synthetic endpoint's outage forced the pre-registered free-tier fallback,
cost-unknown, metered ceiling 0.5 configured, 793 events): M proof run carrying
the holder-kill drill — holder pid + its process group killed mid-round-1 with
the reviewer in flight, orphan observed (ppid 1, own pgid), `resume` appending
exactly one classified `resume{session-continuation}` (seq 296) with the
ledger's in-flight session and **no second `round_open`** (the log-fidelity
pair live), the retry ledger continuing the same opencode session. Final gate
v1: zero-signal probe rejected with directive guidance, steer foreign-id probe
crashed the waiter (F-C1 — the steer settle path escapes throws), `VETO:`
directive settled; the revision carried `EVENT_PAYLOAD_CAP = 3` as a named
decision across artifacts; v2 approved. The metered cost-unknown R4 branch
recorded at both final presentations. Terminal memo `completed`.

## killed-turn-usage-undercount-live

The v2-live-proof (C8) Run B pass 4 (2026-09-02, `zai-coding-plan/glm-5.3`,
unmetered `budget: null`, `deadline: 10` armed, 424 events): the
`POLICY-INTEGRITY` drill — `resolutions-1.json` corrupted to unparseable one
second after round 1's `round_close`; the final gate presented with the
ladder's `auto_decision{rule: none}` (no rule auto-decided — passes 1–3 of the
same matrix slot had each R1-approved in milliseconds) and was settled by an
explicit human `APPROVE`. The deadline stayed armed-never-claimed (F-C3: the
production waiter wiring omits the expiry ports). Terminal memo `completed`.
The matrix slot's bought-verification-round evidence (round 3 needs-review at
cap → `round_open(4, cap 4)`) lives in pass 1's workdir-resident log, cited
from the change notes and the corpus report.

## mutation-gate-widening-live

The execution-half (de-facto C9) Run P (2026-09-03→04, `zai-coding-plan/glm-5.3-flash`
→ `glm-5.3` mid-run per the pre-registered fallback, metered ceiling $0.10 crossed
mid-draft, $13.32 nominal total, 3,285 events): the priced-metered armed run through
the full execution half — final v1 settled `VETO: consolidate` (the redirect cycle
with the tail re-run and no new review round), v2 `APPROVE` igniting the walk with
the D3 mover→answer ordering live (seq 970–972); the implementer-child kill drill
(`retrying{stall}` → `stage_failed` → the under-budget re-run continuing the killed
session `--session ses_f95784f40ffe…`, the F-A4 fix's first live proof) driving
escalation v3 with the **R5 numeric branch** (`auto_decision{rule: R5}` at $0.38 ≥
$0.10, extend suppressed from the rendered gate); the slice commits (`--no-verify`,
the F-P1 escape-clause fix proven live at `f2875edbc`); red-verify routing back as
a normal outcome with the self-answering artifact; and the release gate v8
(verb-only, zero-signal probe rejected, `APPROVE` exit-then-answer → completed).
Findings F-P1–F-P4 recorded in the change notes. Terminal memo `completed`.

## runner-cli-config-live

The execution-half (de-facto C9) Run U (2026-09-04→05, `zai-coding-plan/glm-5.3`,
`budget: null` unmetered, `deadline: 10` armed, $6.35 nominal, 7,767 events —
inflated by the F-U1 flood, kept as honest evidence): the unmetered armed run —
the escalation gate's wired deadline claimed long after expiry with its
`auto_decision{none, pending}` audit trail (the F-C3 fix's first live proof) and
then flooded one pending per waiter tick until the explicit settle (**F-U1**, the
single-re-arm contract broken in production, escape-clause fixed per-gate-once —
the log's 6,333 duplicate pendings are the finding's evidence); the holder-kill
mid-implement drill (exactly one `resume{stage-rebuild, implement}`, the re-pick
continuing the killed session per (label, round) keying); the F-P2 generalized
shape (every red-first item failing the green-per-item affected check) ridden by
operator re-targets to the surgical completion; verify red×3 (cwd leak, killed
hang, real lint) → green; the release gate v12's brutally honest digest (tasks
0/24 walked-done) settled `APPROVE` → completed. Terminal memo `completed`.

## walk-item-green-live

The walk-item-green-decomposition drill run W (2026-09-08,
`zai-coding-plan/glm-5.3`, `budget: null` unmetered, no deadline, $17.15 nominal,
2,841 events): the F-P2 fix's owed live verification — the decomposer's 13-item
plan carries **zero test-only items and zero test/impl splits** (every code item
bundles its reproducing tests; the contract held on the first post-fix armed run),
and the walk completed **13/13 tasks with zero operator re-targets** (operator
writes: two gate APPROVEs, the pre-registered induced `mv` + restore, three
`resume` invocations — no hand merges, no baseline-resetting commits, no surgical
completions; **zero escalation gates**, the C9 contrast). Honest incidents kept:
t6's 30-min spawn wall cap (`stage_failed{exhausted}` → under-budget re-run
continuing the same session id — the F-A4 shape, wall-cap flavored); the induced
F-P3 attempt crashing the holder at the **commit-time** tasks.md read
(`slice-commit.ts`, outside the guard's wrap — finding **F-W1**, routed to
`afk-runner-walk-robustness`) recovered by restore + exactly one
`resume{stage-rebuild, implement}`; the third-strike concern thrash (round-3
convergence `concerns` field, no verification round bought, `### Concern history`
rendered at the final gate). Final v1 approve (D3 mover-first, seq 1136–1137),
verify-1 green first time (18,023 tests), release v2 approve (D7 exit-then-answer,
seq 2840–2841). Terminal memo `completed`.
