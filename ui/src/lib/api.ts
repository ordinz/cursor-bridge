import type { AgentInfo, FeedItem, Model, Project, Session } from "./types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  return res.json();
}

export async function getHealth() {
  return json<{ ok: boolean; apiKeyConfigured: boolean }>("/api/health");
}

export async function getProjects() {
  return json<{
    projects: Project[];
    root: string;
    enabledProjects: string[];
  }>("/api/projects");
}

export async function getModels() {
  return json<{ models: Model[] }>("/api/models");
}

export async function getAgents(project: string) {
  return json<{ agents: AgentInfo[] }>(
    `/api/agents?project=${encodeURIComponent(project)}`,
  );
}

export async function getAgentHistory(agentId: string, project: string) {
  return json<{ items: FeedItem[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/history?project=${encodeURIComponent(project)}`,
  );
}

export async function deleteAgent(agentId: string, project: string) {
  return json<{ ok: boolean; closedSession: string | null }>(
    `/api/agents/${encodeURIComponent(agentId)}?project=${encodeURIComponent(project)}`,
    { method: "DELETE" },
  );
}

export async function getSessions() {
  return json<{ sessions: Session[] }>("/api/sessions");
}

export async function createSession(project: string, model: string) {
  return json<Session>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, model }),
  });
}

export async function resumeSession(
  agentId: string,
  project: string,
  model: string,
) {
  return json<Session>("/api/sessions/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, project, model }),
  });
}

export async function cancelSession(sessionId: string) {
  return json<{ ok: boolean }>(`/api/sessions/${sessionId}/cancel`, {
    method: "POST",
  });
}

export async function closeSession(sessionId: string) {
  return json<{ ok: boolean }>(`/api/sessions/${sessionId}`, {
    method: "DELETE",
  });
}
