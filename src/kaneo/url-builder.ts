export function buildTaskUrl(baseUrl: string, workspaceId: string, projectId: string, taskId: string): string {
  return `${baseUrl}/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`
}

export function buildProjectUrl(baseUrl: string, workspaceId: string, projectId: string): string {
  return `${baseUrl}/dashboard/workspace/${workspaceId}/project/${projectId}`
}
