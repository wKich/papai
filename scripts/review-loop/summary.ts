import type { ReviewLoopResult } from './loop-controller.js'

export function formatSummary(result: ReviewLoopResult): string {
  const records = Object.values(result.ledger.issues)
  const counts = {
    closed: records.filter((record) => record.status === 'closed').length,
    rejected: records.filter((record) => record.status === 'rejected').length,
    alreadyFixed: records.filter((record) => record.status === 'already_fixed').length,
    needsHuman: records.filter((record) => record.status === 'needs_human').length,
    reopened: records.filter((record) => record.status === 'reopened').length,
  }
  const totalFixChanges = records.reduce((acc, record) => acc + record.fixChanges.length, 0)

  return [
    `Done reason: ${result.doneReason}`,
    `Rounds executed: ${result.rounds}`,
    `Closed issues: ${counts.closed}`,
    `Rejected issues: ${counts.rejected}`,
    `Already fixed: ${counts.alreadyFixed}`,
    `Needs human: ${counts.needsHuman}`,
    `Reopened issues: ${counts.reopened}`,
    `Recorded fix changes: ${totalFixChanges}`,
  ].join('\n')
}
