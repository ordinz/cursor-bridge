/** Shared API + SSE types for cursor-bridge clients (UI and external agents). */

export interface HealthResponse {
  ok: boolean;
  version: string;
  bridge: {
    status: "up";
    host: string;
    port: number;
  };
  cursor: {
    apiKeyConfigured: boolean;
    ready: boolean;
    reason: string | null;
  };
}

export interface Project {
  id: string;
  name: string;
  path?: string;
  enabled?: boolean;
  canCreateSession: boolean;
}

export interface ProjectsResponse {
  projects: Project[];
}

export interface Model {
  id: string;
  displayName: string;
  description?: string;
}

export type RunStatus =
  | "idle"
  | "running"
  | "error"
  | "cancelled"
  | "finished";

export interface Session {
  sessionId: string;
  agentId: string;
  project: string;
  cwd: string;
  model: string;
  name?: string;
  runStatus: RunStatus | string;
  runActive: boolean;
  createdAt: number;
  lastActivityAt: number;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  namedFromPrompt?: boolean;
}

export interface ApiErrorBody {
  error: string;
  code: string;
  sessionId?: string;
}

export type FeedItemSource = "manual" | "api" | "history";

export interface AgentInfo {
  agentId: string;
  name: string;
  summary: string;
  lastModified: number;
  status?: "running" | "finished" | "error";
  cwd?: string;
}

export type FeedItem =
  | { id: string; kind: "user"; text: string; source?: FeedItemSource }
  | { id: string; kind: "assistant"; text: string }
  | {
      id: string;
      kind: "tool";
      callId: string;
      name: string;
      status: "running" | "completed" | "error";
      args?: unknown;
      result?: unknown;
    }
  | { id: string; kind: "status"; status: string; message?: string }
  | { id: string; kind: "error"; message: string };

/** Base fields present on every SSE event from the bridge. */
export interface SseEnvelope {
  type: string;
  sessionId: string | null;
  timestamp: string;
}

export type SseEvent =
  | (SseEnvelope & {
      type: "session";
      agentId: string;
      project?: string;
      cwd?: string;
      name?: string;
      runStatus?: string;
      runActive?: boolean;
    })
  | (SseEnvelope & { type: "status"; status: string; message?: string })
  | (SseEnvelope & { type: "assistant"; text: string })
  | (SseEnvelope & {
      type: "user";
      text: string;
      source?: string;
    })
  | (SseEnvelope & {
      type: "tool_call";
      callId: string;
      name: string;
      status: "running";
      args?: unknown;
    })
  | (SseEnvelope & {
      type: "tool_result";
      callId: string;
      name: string;
      status: "completed" | "error";
      result?: unknown;
      truncated?: boolean;
    })
  | (SseEnvelope & {
      type: "done";
      runId?: string;
      status: string;
    })
  | (SseEnvelope & {
      type: "error";
      message: string;
      code?: string;
    })
  | (SseEnvelope & { type: "thinking"; text: string })
  | (SseEnvelope & {
      type: "system";
      subtype?: string;
      agentId?: string;
      runId?: string;
    });
