/** Bridge REST + SSE types (aligned with shared/api-types.ts). */

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

export interface Session {
  sessionId: string;
  agentId: string;
  project: string;
  cwd: string;
  model: string;
  name?: string;
  runStatus: string;
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

export interface SseEnvelope {
  type: string;
  sessionId: string | null;
  timestamp: string;
}

export type SseEvent =
  | (SseEnvelope & { type: "status"; status: string; message?: string })
  | (SseEnvelope & { type: "assistant"; text: string })
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
  | (SseEnvelope & { type: "done"; runId?: string; status: string })
  | (SseEnvelope & { type: "error"; message: string; code?: string })
  | (SseEnvelope & { type: string; [key: string]: unknown });

export interface ToolCallRecord {
  callId: string;
  name: string;
  args?: unknown;
  status: "running" | "completed" | "error";
  result?: unknown;
  truncated?: boolean;
}

export interface StatusEventRecord {
  status: string;
  message?: string;
  timestamp: string;
}

export interface ChatStreamResult {
  status: "finished" | "cancelled" | "error";
  assistantText: string;
  toolCalls: ToolCallRecord[];
  statusEvents: StatusEventRecord[];
  terminal?: SseEvent;
  runId?: string;
  errorMessage?: string;
  errorCode?: string;
}

export type BridgeErrorCode =
  | "SESSION_BUSY"
  | "NO_ACTIVE_RUN"
  | "SESSION_NOT_FOUND"
  | "INVALID_REQUEST"
  | "PROMPT_TOO_LONG"
  | "UNKNOWN_PROJECT"
  | "PROJECT_DISABLED"
  | "RUN_FAILED"
  | "BRIDGE_ERROR"
  | "CURSOR_NOT_READY";

export class BridgeError extends Error {
  code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}
