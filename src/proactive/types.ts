export type AlertType = 'deadline_nudge' | 'due_today' | 'overdue' | 'staleness' | 'blocked'

export type BriefingTask = {
  id: string
  title: string
  url?: string
  dueDate?: string | null
  status?: string
  priority?: string
}

export type BriefingSection = {
  title: string
  tasks: BriefingTask[]
}

export type CreateReminderParams = {
  userId: string
  text: string
  fireAt: string
  recurrence?: string
  taskId?: string
}

export type AlertCheckResult = {
  sent: number
  suppressed: number
}

export type ReminderStatus = 'pending' | 'delivered' | 'snoozed' | 'cancelled'
