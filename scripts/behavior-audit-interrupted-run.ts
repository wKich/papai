// Re-export entry point for the interrupted-run scenario.
// Tests covering interrupted-run behavior of the main audit orchestrator
// live in tests/scripts/behavior-audit-interrupted-run.test.ts.
export { runBehaviorAudit, type BehaviorAuditDeps } from './behavior-audit.js'
