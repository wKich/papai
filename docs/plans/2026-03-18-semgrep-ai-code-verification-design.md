# Semgrep and AI-Generated Code Verification Design

Date: 2026-03-18

## Goal

Add a strict but practical verification layer for this repository that improves review of AI-assisted code without changing the rule that all code is held to the same standard. The design adds Semgrep to the existing CI pipeline, keeps the current correctness checks, and introduces a small repo-specific policy layer for patterns that are especially risky in this codebase.

## Project Context

This repository already has strong baseline verification in GitHub Actions:

- formatting via `bun run format:check`
- linting via `bun run lint`
- type checking via `bun tsc --noEmit`
- unit tests via `bun run test`
- e2e tests via `bun run test:e2e`

The repo also already documents some code-generation guardrails in `.github/copilot-instructions.md`, including a ban on suppression comments such as `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, and `oxlint-disable`.

The missing piece is a dedicated static-analysis and policy layer focused on security-sensitive and architecture-sensitive patterns. That gap matters more when AI-assisted code is introduced, because current research and guidance consistently show that AI-generated code can be plausible while still containing security flaws, outdated practices, unsafe dependencies, or missing validation.

## Constraints and Decisions

- Enforce verification in CI.
- Provide an optional local verification command.
- Use moderate PR blocking, not advisory-only and not fully strict on every finding.
- Use standard Semgrep rules plus a small repo-specific ruleset.
- Do not require explicit AI-authorship tracking or labels; verify all code equally.

## Evaluated Approaches

### Recommended: Layered Moderate Gate

Add Semgrep as a dedicated CI job alongside the existing jobs, keep the current format/lint/type/test/e2e gates, and fail PRs only on actionable or explicitly forbidden findings. Add a fast local command so contributors can reproduce the core gate before pushing.

Why this is recommended:

- fits the current CI structure cleanly
- follows NIST guidance to combine multiple verification techniques instead of relying on one tool
- gives meaningful enforcement without turning first rollout noise into friction
- supports gradual tuning of custom rules and excludes

### Alternative: Advisory-First Rollout

Add Semgrep as a non-blocking reporting job first, use it to collect findings, then later convert it to a blocking gate.

Trade-offs:

- easier adoption
- weaker assurance during rollout
- higher chance that risky patterns still merge while tuning happens

### Alternative: Strict Universal Blocker

Block PRs on nearly all Semgrep findings and require local verification before merge.

Trade-offs:

- strongest policy on paper
- likely too noisy without a mature baseline and tuned ignores
- creates avoidable friction for contributors and reviewers

## Architecture

### CI Structure

Keep the current jobs in `.github/workflows/ci.yml` unchanged and add a new Semgrep job for pull requests and pushes to the default branch.

The new job should:

- run diff-aware scanning for PRs to reduce noise
- run a full scan on the default branch
- act as a separate security and policy gate rather than replacing formatting, linting, type checking, or tests

This structure keeps correctness verification and security-policy verification separate, which improves triage and makes failures easier to understand.

### Local Workflow

Add one optional local command that runs the fast verification subset:

- formatting check
- lint
- typecheck
- unit tests
- Semgrep scan

E2E tests remain primarily CI-enforced because they are slower and require more setup.

## Enforcement Model

### Existing Correctness Gates

Keep these exactly as they are today:

- `bun run format:check`
- `bun run lint`
- `bun tsc --noEmit`
- `bun run test`
- current e2e behavior in CI

These checks already enforce syntax, style, type safety, and behavioral correctness. Semgrep should complement them, not replace them.

### Semgrep Gate

Use moderate enforcement:

- block on high-confidence or high-severity findings
- block on a small set of custom project policy rules that are always unacceptable
- report lower-confidence findings as advisory review signals rather than hard failures during the initial rollout

### Repo-Specific Hard-Block Rules

The first custom ruleset should stay intentionally small and target repeatable architectural and security issues relevant to this repo:

1. Hardcoded secrets or tokens in code or workflow files
2. Forbidden suppression escapes such as `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, and `oxlint-disable`
3. Risky shell execution patterns in scripts or TypeScript when untrusted input may reach a command
4. Direct backend or HTTP access patterns that bypass existing validated wrappers, especially where the repo expects centralized Kaneo client behavior, schema validation, and logging
5. Unsafe parsing or unchecked deserialization patterns that bypass the repo's established Zod validation conventions

### Non-Blocking Review Signals

Surface, but do not initially block on:

- suspicious dependency additions
- weak or deprecated crypto usage
- insecure temp-file or file-permission patterns
- overly broad error exposure
- sensitive data appearing in logs

These findings should inform review and future rule tuning.

## Developer and Reviewer Workflow

1. A contributor opens a PR.
2. Existing CI jobs run.
3. The Semgrep job runs a diff-aware scan for the PR.
4. If there are blocking findings, the Semgrep job fails and merge is blocked.
5. If there are only advisory findings, they remain visible for reviewer attention but do not block merge.
6. Reviewers continue ordinary code review; Semgrep acts as an additional signal, not a substitute for human review.

This design intentionally avoids special handling for AI-authored code. The review principle is that all code, regardless of origin, must pass the same engineering and security controls.

## Error Handling and False Positive Control

### Rule Tuning Strategy

Start narrow. The custom ruleset should be small, explicit, and tied to this repository's actual conventions.

When a blocking rule is noisy, resolve issues in this order:

1. confirm the finding is real or false positive
2. narrow the rule to reduce noise
3. add a precise exclusion only if necessary
4. downgrade block/advisory behavior only after the first three steps fail

### Ignore Policy

Use explicit excludes or `.semgrepignore` only for justified noise such as generated artifacts or vendored code. Do not broadly exclude workflow files or tests by default, because both can contain meaningful security issues.

Semgrep suppression features such as `nosem` should be discouraged. Central rule tuning is preferred over local suppression.

### Risky Semgrep Features to Avoid by Default

Do not enable the following unless there is a proven need and a review of the risk:

- `--allow-local-builds`, because Semgrep documents that it may execute project or dependency code while resolving dependencies
- untrusted validators
- autofix in CI gating

## Testing and Validation Strategy

### Layered Verification

The verification model remains layered:

- formatting and linting for style and obvious mistakes
- type checking for static correctness
- unit and e2e tests for behavior
- Semgrep for policy and security-sensitive static analysis

This aligns with NIST guidance that code verification should combine static analysis, automated testing, secret checks, dependency scrutiny, and additional targeted techniques where appropriate.

### Validating the Semgrep Policy Itself

Treat the Semgrep configuration as tested policy, not passive configuration.

Add small fixtures or examples that demonstrate:

- a prohibited pattern that must trigger a finding
- an approved project pattern that must not trigger a finding

That keeps the ruleset from drifting silently and helps maintain confidence when rules evolve.

### Regression Strategy

When a real issue is caught:

- add a test if the issue is behavior-specific
- add or refine a Semgrep rule if the issue is architectural and repeatable
- use both when the issue spans behavior and policy

## Success Criteria

The design is successful when:

- PRs continue to pass existing correctness gates unchanged
- Semgrep catches meaningful issues without overwhelming reviewers
- the initial custom ruleset reflects real repository conventions rather than generic style preferences
- contributors can reproduce the fast gate locally
- the repository gains stronger assurance for AI-assisted and human-authored code alike

## Initial Scope Boundaries

This design does not include:

- mandatory local pre-commit or pre-push enforcement
- AI-authorship tags, labels, or commit metadata requirements
- an expansive custom Semgrep policy from day one
- replacing human review with automated analysis
- enabling every possible Semgrep feature at initial rollout

## Source Basis

This design is based on the following current guidance reviewed during the design process:

- Semgrep documentation on CLI and CI usage, diff-aware PR scanning, baseline behavior, include/exclude handling, and security-sensitive options such as `--allow-local-builds`
- NIST, "Recommended Minimum Standard for Vendor or Developer Verification of Code," which recommends layered verification including threat modeling, automated testing, static analysis, hardcoded secret checks, structural tests, fuzzing where relevant, and included-software checks
- OpenSSF, "Security-Focused Guide for AI Code Assistant Instructions," which states that AI-generated code should still go through review, testing, static analysis, dependency scrutiny, and iterative improvement
- OWASP guidance on LLM and application security risks, especially overreliance on model output, insecure output handling, and supply-chain concerns

## Recommended Next Step

The next step is to create an implementation plan that specifies:

- the Semgrep workflow shape for GitHub Actions
- the local verification command
- the initial Semgrep config structure
- the first repo-specific custom rules
- the rollout and tuning sequence
