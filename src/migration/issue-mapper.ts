import type { IssuePriority } from '../huly/types.js'
import { logger } from '../logger.js'
import type { LinearIssue } from './linear-client.js'

const log = logger.child({ scope: 'issue-mapper' })

export interface HulyIssueData {
  title: string
  description?: string
  project: string
  priority?: IssuePriority
  labels?: string[]
}

export function mapLinearPriorityToHuly(linearPriority: number): IssuePriority | undefined {
  // Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  // Huly: 'urgent' | 'high' | 'medium' | 'low'
  switch (linearPriority) {
    case 1:
      return 'urgent'
    case 2:
      return 'high'
    case 3:
      return 'medium'
    case 4:
      return 'low'
    default:
      return undefined
  }
}

export function mapLinearStatusToHuly(linearStatus: string): string {
  // Map Linear states to Huly states
  // This is a simplified mapping - customize based on your workflow
  const statusMap: Record<string, string> = {
    Backlog: 'Backlog',
    Todo: 'Todo',
    'In Progress': 'In Progress',
    Done: 'Done',
    Canceled: 'Canceled',
  }
  return statusMap[linearStatus] ?? 'Backlog'
}

export function mapLinearIssueToHuly(linearIssue: LinearIssue, hulyProjectId: string): HulyIssueData {
  log.debug({ linearId: linearIssue.id }, 'Mapping Linear issue to Huly')

  return {
    title: linearIssue.title,
    description: linearIssue.description,
    project: hulyProjectId,
    priority: mapLinearPriorityToHuly(linearIssue.priority),
    labels: linearIssue.labels.map((l) => l.name),
  }
}
