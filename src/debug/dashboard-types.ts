/// <reference lib="dom" />

/**
 * Dashboard state object exposed on window for render functions
 */
export interface DashboardState {
  connected: boolean
  stats: {
    startedAt: number
    totalMessages: number
    totalLlmCalls: number
    totalToolCalls: number
  }
  sessions: Map<string, Session>
  wizards: Map<string, Wizard>
  scheduler: SchedulerInfo
  pollers: PollersInfo
  messageCache: MessageCacheInfo
  llmTraces: LlmTrace[]
  logs: LogEntry[]
  logScopes: Set<string>
}

export interface Session {
  userId: string
  lastAccessed: number
  historyLength: number
  factsCount: number
  summary: string | null
  configKeys: string[]
  workspaceId: string | null
}

export interface Wizard {
  userId: string
  currentStep: number
  totalSteps: number
}

export interface SchedulerInfo {
  running?: boolean
  tickCount?: number
}

export interface PollersInfo {
  scheduledRunning?: boolean
  alertsRunning?: boolean
}

export interface MessageCacheInfo {
  size?: number
  pendingWrites?: number
}

export interface TokenInfo {
  inputTokens: number
  outputTokens: number
}

export interface ToolCall {
  toolName: string
  durationMs: number
  success: boolean
}

export interface LlmTrace {
  timestamp: string | number
  userId: string
  model: string
  duration: number
  steps: number
  totalTokens: TokenInfo
  toolCalls?: ToolCall[]
  error?: string
}

export interface LogEntry {
  time: string | number
  level: number
  msg: string
  scope?: string
}

/**
 * Dashboard API functions exposed on window
 */
export interface DashboardAPI {
  renderConnection(connected: boolean): void
  renderStats(stats: DashboardState['stats']): void
  renderInfra(scheduler: SchedulerInfo, pollers: PollersInfo, messageCache: MessageCacheInfo): void
  renderSessions(sessions: Map<string, Session>, wizards: Map<string, Wizard>): void
  renderTraces(traces: LlmTrace[]): void
  renderLogs(): void
  updateScopeFilter(scopes: Set<string>): void
  clearLogs(): void
  __state: DashboardState
}

declare global {
  interface Window {
    dashboard: DashboardAPI
  }
}
