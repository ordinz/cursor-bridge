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
  agents: {
    activeRuns: number;
    sessionCount: number;
  };
  telegram: {
    enabled?: boolean;
    configured: boolean;
    webhookConfigured?: boolean;
    phoneMode?: boolean;
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

export interface DevStatus {
  projectId: string;
  capturing: boolean;
  devServerReachable: boolean;
  port: number | null;
  lineCount: number;
  logFile: string;
  managedPid: number | null;
  fileRecent?: boolean;
}

export interface DevLogsResponse {
  lines: string[];
  truncated: boolean;
  source: "buffer" | "file" | "none";
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

export interface ConversationReadEntry {
  lastReadAt: number;
  lastCompletedAt: number;
  lastSortAt: number;
}

export interface ConversationReadsResponse {
  reads: Record<string, ConversationReadEntry>;
}

export interface Session {
  sessionId: string;
  agentId: string;
  project: string;
  cwd: string;
  model: string;
  name?: string;
  /** Forum message_thread_id when phone mode bound a Telegram topic. */
  telegramThreadId?: number | null;
  /** Deep link into the agent's Telegram forum topic (`t.me/c/…`). */
  telegramTopicUrl?: string | null;
  runStatus: RunStatus | string;
  runActive: boolean;
  createdAt: number;
  lastActivityAt: number;
  /** Sort key for Recent — not updated by streaming chunks. */
  listActivityAt?: number;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  namedFromPrompt?: boolean;
}

export interface ApiErrorBody {
  error: string;
  code: string;
  sessionId?: string;
}

export interface TelegramSendResponse {
  ok: boolean;
  messageId: number | null;
}

export type FeedItemSource = "manual" | "api" | "history";

export interface AgentInfo {
  agentId: string;
  name: string;
  summary: string;
  lastModified: number;
  status?: "running" | "finished" | "error";
  archived?: boolean;
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
      imageCount?: number;
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
