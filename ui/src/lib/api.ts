import type {
  AgentInfo,
  ApiErrorBody,
  ConversationReadEntry,
  ConversationReadsResponse,
  DevLogsResponse,
  DevStatus,
  FeedItem,
  HealthResponse,
  Model,
  ProjectsResponse,
  Session,
  TelegramSendResponse,
} from "./types";

export class ApiError extends Error {
  code: string;
  status: number;
  sessionId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.name = "ApiError";
    this.code = body.code;
    this.status = status;
    this.sessionId = body.sessionId;
  }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(res.status, {
      error: body.error ?? res.statusText,
      code: body.code ?? "REQUEST_FAILED",
      sessionId: body.sessionId,
    });
  }
  return res.json();
}

export async function getHealth() {
  return json<HealthResponse>("/api/health");
}

export async function getProjects() {
  return json<ProjectsResponse>("/api/projects");
}

export async function getDevStatus(projectId: string) {
  return json<DevStatus>(
    `/api/projects/${encodeURIComponent(projectId)}/dev-status`,
  );
}

export async function getDevLogs(projectId: string, lines = 150) {
  return json<DevLogsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/dev-logs?lines=${lines}`,
  );
}

export async function getModels() {
  return json<{ models: Model[] }>("/api/models");
}

export async function getAgents(
  project: string,
  opts?: {
    includeArchived?: boolean;
    cursor?: string;
    limit?: number;
    q?: string;
  },
) {
  const q = new URLSearchParams({ project });
  if (opts?.includeArchived) q.set("includeArchived", "true");
  if (opts?.cursor) q.set("cursor", opts.cursor);
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  if (opts?.q?.trim()) q.set("q", opts.q.trim());
  return json<{
    agents: AgentInfo[];
    nextCursor?: string | null;
    searchExhausted?: boolean;
    pagesSearched?: number;
  }>(`/api/agents?${q}`);
}

export async function getAgentHistory(agentId: string, project: string) {
  return json<{ items: FeedItem[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/history?project=${encodeURIComponent(project)}`,
  );
}

export async function archiveAgent(agentId: string, project: string) {
  return json<{ ok: boolean; closedSession: string | null }>(
    `/api/agents/${encodeURIComponent(agentId)}/archive?project=${encodeURIComponent(project)}`,
    { method: "POST" },
  );
}

export async function unarchiveAgent(agentId: string, project: string) {
  return json<{ ok: boolean }>(
    `/api/agents/${encodeURIComponent(agentId)}/unarchive?project=${encodeURIComponent(project)}`,
    { method: "POST" },
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

export async function getConversationReads() {
  return json<ConversationReadsResponse>("/api/conversation-reads");
}

export async function markConversationRead(project: string, agentId: string) {
  return json<{
    ok: boolean;
    key: string;
    entry: ConversationReadEntry;
  }>("/api/conversation-reads/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, agentId }),
  });
}

export async function getSession(sessionId: string) {
  return json<Session>(`/api/sessions/${encodeURIComponent(sessionId)}`);
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
  return json<{ ok: boolean; sessionId: string; runStatus: string }>(
    `/api/sessions/${sessionId}/cancel`,
    { method: "POST" },
  );
}

export async function closeSession(sessionId: string) {
  return json<{ ok: boolean }>(`/api/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function sendTelegram(message: string) {
  return json<TelegramSendResponse>("/api/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}
