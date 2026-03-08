import { IssuePriority } from '@hcengineering/tracker'

/**
 * Maps input priority values to Huly IssuePriority enum
 * Input: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
 * Huly: NoPriority=0, Urgent=1, High=2, Medium=3, Low=4
 */
export function mapInputPriorityToHuly(priority: number | undefined): IssuePriority {
  if (priority === undefined) {
    return IssuePriority.NoPriority
  }
  switch (priority) {
    case 0:
      return IssuePriority.NoPriority
    case 1:
      return IssuePriority.Urgent
    case 2:
      return IssuePriority.High
    case 3:
      return IssuePriority.Medium
    case 4:
      return IssuePriority.Low
    default:
      return IssuePriority.NoPriority
  }
}

/**
 * Maps Huly priority values to output priority scale
 * Huly: NoPriority=0, Urgent=1, High=2, Medium=3, Low=4
 * Output: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
 */
export function mapHulyPriorityToOutput(hulyPriority: number): number {
  const priorityMap: Record<number, number> = {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
  }
  return priorityMap[hulyPriority] ?? 0
}
