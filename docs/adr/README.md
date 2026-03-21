# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the **papai** project.

ADRs capture the context, options considered, and rationale behind significant architectural decisions. Each ADR is derived from an implementation plan in `docs/plans/done/` and verified against the current codebase.

## Index

| ADR                                                           | Title                                                          | Date       | Implementation Status                 |
| ------------------------------------------------------------- | -------------------------------------------------------------- | ---------- | ------------------------------------- |
| [0001](0001-youtrack-zod-schema-library.md)                   | YouTrack Zod Schema Library                                    | 2025-03-18 | Implemented (with divergence)         |
| [0002](0002-youtrack-runtime-validation-and-types-removal.md) | YouTrack Runtime Validation via Zod Parse and types.ts Removal | 2026-03-18 | Implemented (via direct schema reuse) |
| [0003](0003-e2e-test-harness-with-docker.md)                  | E2E Test Harness with Docker Compose                           | 2026-03-13 | Implemented (with deviations)         |
| [0004](0004-comprehensive-e2e-test-coverage.md)               | Comprehensive E2E Test Coverage for Kaneo Operations           | 2026-03-13 | Implemented                           |
| [0005](0005-e2e-test-failure-remediation.md)                  | E2E Test Failure Remediation Strategy                          | 2026-03-13 | Implemented (partial deviation)       |
| [0007](0007-layered-architecture-enforcement.md)              | Layered Architecture Enforcement                               | 2026-03-13 | Implemented                           |
| [0008](0008-ddd-tactical-patterns.md)                         | DDD Tactical Patterns                                          | 2026-03-13 | Partially Implemented                 |
| [0009](0009-multi-provider-task-tracker-support.md)           | Multi-Provider Task Tracker Support                            | 2026-03-13 | Implemented                           |
| [0010](0010-drizzle-orm-migration.md)                         | Drizzle ORM for Database Access                                | 2025-03-20 | Implemented                           |
| [0011](0011-knip-dead-code-detection.md)                      | Knip for Dead Code Detection and Enforced Export Hygiene       | 2026-03-18 | Implemented                           |
| [0013](0013-semgrep-security-scanning.md)                     | Semgrep Security Scanning Integration                          | 2026-03-18 | Implemented                           |
| [0014](0014-multi-chat-provider-abstraction.md)               | Multi-Chat Provider Abstraction                                | 2026-03-19 | Implemented                           |
| [0015](0015-enhanced-tool-capabilities.md)                    | Enhanced Tool Capabilities (Phase 02)                          | 2026-03-20 | Implemented                           |
| [0016](0016-conversation-persistence-and-context.md)          | Conversation Persistence and Context Management (Phase 03)     | 2026-03-20 | Implemented                           |

## Skipped / Not Written

| Plan                              | Reason                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `2026-03-16-fix-failing-tests.md` | Bug fix and test hygiene — no architectural decision, no options considered   |
| ADR-0006                          | Merged into ADR-0005 (design + implementation of the same remediation effort) |
| ADR-0012                          | Reserved slot; corresponding plan not architectural                           |

## ADR Status Legend

- **Implemented** — All key outcomes verified present in the codebase
- **Implemented (with divergence)** — Implemented but with notable deviations from the original plan
- **Partially Implemented** — Some planned items present; others not implemented or replaced
- **Not Implemented** — Plan was written but not executed

## Creating a New ADR

1. Copy an existing ADR file as a template
2. Increment the number from the last entry
3. Fill in all sections, including **Implementation Status** with codebase evidence
4. Add a row to this index

## ADR Lifecycle

```
Proposed → Accepted → Deprecated → Superseded
              ↓
           Rejected
```
