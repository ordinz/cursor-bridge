export interface Model {
  id: string;
  displayName: string;
  description?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
}

export interface Session {
  sessionId: string;
  agentId: string;
  project: string;
  cwd: string;
  model: string;
  name?: string;
  runStatus: string;
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

export type SseEvent =
  | { type: "assistant"; text: string }
  | { type: "user"; text: string; source?: string }
  | {
      type: "tool_call";
      callId?: string;
      name: string;
      status: "running" | "completed" | "error";
      args?: unknown;
      result?: unknown;
    }
  | { type: "status"; status: string; message?: string }
  | {
      type: "session";
      sessionId: string;
      agentId: string;
      project?: string;
      cwd?: string;
      name?: string;
    }
  | { type: "done"; runId?: string; status: string }
  | { type: "error"; message: string };
