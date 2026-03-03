import { LinearClient } from "@linear/sdk";

const client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! });

export async function createIssue({
  title,
  description,
  priority,
  projectId,
  teamId,
}: {
  title: string;
  description?: string;
  priority?: number;
  projectId?: string;
  teamId: string;
}) {
  const payload = await client.createIssue({
    title,
    description,
    priority,
    projectId,
    teamId,
  });
  return payload.issue;
}

export async function updateIssue({
  issueId,
  status,
  assigneeId,
}: {
  issueId: string;
  status?: string;
  assigneeId?: string;
}) {
  const updateInput: IssueUpdateInput = {};

  if (status) {
    const issue = await client.issue(issueId);
    const team = await issue.team;
    if (team) {
      const states = await team.states();
      const state = states.nodes.find(
        (s) => s.name.toLowerCase() === status.toLowerCase(),
      );
      if (state) {
        updateInput.stateId = state.id;
      }
    }
  }

  if (assigneeId) {
    updateInput.assigneeId = assigneeId;
  }

  const payload = await client.updateIssue(issueId, updateInput);
  return payload.issue;
}

export async function searchIssues({
  query,
  state,
}: {
  query: string;
  state?: string;
}) {
  const result = await client.issueSearch(query, { includeArchived: false });
  const issues = result.nodes;

  if (state) {
    const filtered = await Promise.all(
      issues.map(async (issue) => {
        const issueState = await issue.state;
        return issueState?.name.toLowerCase() === state.toLowerCase()
          ? issue
          : null;
      }),
    );
    return filtered.filter(Boolean).map((issue) => ({
      id: issue!.id,
      identifier: issue!.identifier,
      title: issue!.title,
      priority: issue!.priority,
      url: issue!.url,
    }));
  }

  return issues.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    priority: issue.priority,
    url: issue.url,
  }));
}

export async function listProjects() {
  const teams = await client.teams();
  const result = await Promise.all(
    teams.nodes.map(async (team) => {
      const projects = await team.projects();
      return {
        teamId: team.id,
        teamName: team.name,
        projects: projects.nodes.map((p) => ({ id: p.id, name: p.name })),
      };
    }),
  );
  return result;
}
