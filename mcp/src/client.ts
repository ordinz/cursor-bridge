import type {
  ApiErrorBody,
  ChatStreamResult,
  HealthResponse,
  Project,
  Session,
  SseEvent,
  StatusEventRecord,
  ToolCallRecord,
  BridgeErrorCode,
} from "./types.js";
import { BridgeError } from "./types.js";

const KNOWN_CODES = new Set<string>([
  "SESSION_BUSY",
  "NO_ACTIVE_RUN",
  "SESSION_NOT_FOUND",
  "INVALID_REQUEST",
  "PROMPT_TOO_LONG",
  "UNKNOWN_PROJECT",
  "PROJECT_DISABLED",
  "RUN_FAILED",
  "TELEGRAM_NOT_CONFIGURED",
  "TELEGRAM_SEND_FAILED",
]);

function mapErrorCode(code: string | undefined, status: number): BridgeErrorCode {
  if (code && KNOWN_CODES.has(code)) {
    return code as BridgeErrorCode;
  }
  if (status === 404) return "SESSION_NOT_FOUND";
  if (status === 409) return "SESSION_BUSY";
  if (status === 400) return "INVALID_REQUEST";
  if (status === 403) return "PROJECT_DISABLED";
  return "BRIDGE_ERROR";
}

export class BridgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  private url(path: string): string {
    const base = this.baseUrl.replace(/\/$/, "");
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey) return {};
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const res = await fetch(this.url(path), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
      const code = mapErrorCode(body.code, res.status);
      const message = body.error ?? res.statusText;
      throw new BridgeError(code, `${code}: ${message}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  async listProjects(): Promise<
    Array<{
      id: string;
      enabled: boolean;
      canCreateSession: boolean;
      path?: string;
    }>
  > {
    const data = await this.request<{ projects: Project[] }>("/projects");
    return data.projects.map((p) => ({
      id: p.id,
      enabled: p.enabled ?? true,
      canCreateSession: p.canCreateSession ?? true,
      path: p.path,
    }));
  }

  async listModels(): Promise<Array<{ id: string; displayName: string }>> {
    const data = await this.request<{
      models: Array<{ id: string; displayName: string }>;
    }>("/models");
    return data.models.map((m) => ({ id: m.id, displayName: m.displayName }));
  }

  async createSession(project: string, model = "default"): Promise<Session> {
    return this.request<Session>("/sessions", {
      method: "POST",
      body: JSON.stringify({ project, model }),
    });
  }

  async resumeSession(
    agentId: string,
    project: string,
    model?: string,
  ): Promise<Session> {
    const body: Record<string, string> = { agentId, project };
    if (model !== undefined) body.model = model;
    return this.request<Session>("/sessions/resume", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  async listAgents(
    project: string,
  ): Promise<
    Array<{
      agentId: string;
      name: string;
      summary: string;
      lastModified: number;
      status?: string;
      cwd?: string;
    }>
  > {
    const data = await this.request<{
      agents: Array<{
        agentId: string;
        name: string;
        summary: string;
        lastModified: number;
        status?: string;
        cwd?: string;
      }>;
    }>(`/agents?project=${encodeURIComponent(project)}`);
    return data.agents;
  }

  async deleteAgent(agentId: string, project: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/agents/${encodeURIComponent(agentId)}?project=${encodeURIComponent(project)}`,
      { method: "DELETE" },
    );
  }

  async cancelRun(
    sessionId: string,
  ): Promise<{ ok: boolean; sessionId: string; runStatus: string }> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  async sendTelegram(
    message: string,
  ): Promise<{ ok: boolean; messageId: number | null }> {
    return this.request("/telegram", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  }

  async streamChat(
    sessionId: string,
    prompt: string,
    allowOverlap = false,
  ): Promise<ChatStreamResult> {
    const res = await fetch(
      this.url(`/sessions/${encodeURIComponent(sessionId)}/chat`),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ prompt, allowOverlap, source: "api" }),
      },
    );

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
      const code = mapErrorCode(body.code, res.status);
      throw new BridgeError(code, `${code}: ${body.error ?? res.statusText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new BridgeError("BRIDGE_ERROR", "BRIDGE_ERROR: No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let assistantText = "";
    const toolCalls = new Map<string, ToolCallRecord>();
    const statusEvents: StatusEventRecord[] = [];
    let terminal: SseEvent | undefined;
    let runId: string | undefined;
    let errorMessage: string | undefined;
    let errorCode: string | undefined;
    let status: ChatStreamResult["status"] = "finished";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        for (const line of chunk.split("\n")) {
          if (line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line.slice(6)) as Record<string, unknown>;
          } catch {
            continue;
          }

          const eventType = event.type;
          if (typeof eventType !== "string") continue;

          if (eventType === "assistant" && typeof event.text === "string") {
            assistantText += event.text;
          } else if (eventType === "tool_call") {
            const callId = String(event.callId ?? "");
            toolCalls.set(callId, {
              callId,
              name: String(event.name ?? ""),
              args: event.args,
              status: "running",
            });
          } else if (eventType === "tool_result") {
            const callId = String(event.callId ?? "");
            const existing = toolCalls.get(callId);
            toolCalls.set(callId, {
              callId,
              name: String(event.name ?? existing?.name ?? ""),
              args: existing?.args,
              status:
                event.status === "error" ? "error" : "completed",
              result: event.result,
              truncated:
                typeof event.truncated === "boolean"
                  ? event.truncated
                  : undefined,
            });
          } else if (eventType === "status" && typeof event.status === "string") {
            statusEvents.push({
              status: event.status,
              message:
                typeof event.message === "string" ? event.message : undefined,
              timestamp: String(event.timestamp ?? ""),
            });
          } else if (eventType === "done") {
            terminal = event as SseEvent;
            runId = typeof event.runId === "string" ? event.runId : undefined;
            status =
              event.status === "cancelled" ? "cancelled" : "finished";
          } else if (eventType === "error") {
            terminal = event as SseEvent;
            status = "error";
            errorMessage =
              typeof event.message === "string"
                ? event.message
                : "Run failed";
            errorCode =
              typeof event.code === "string" ? event.code : "RUN_FAILED";
          }
        }
      }
    }

    if (status === "error" && !errorCode) {
      errorCode = "RUN_FAILED";
    }

    return {
      status,
      assistantText,
      toolCalls: [...toolCalls.values()],
      statusEvents,
      terminal,
      runId,
      errorMessage,
      errorCode,
    };
  }
}

export function assertLocalBaseUrl(baseUrl: string): void {
  if (process.env.MCP_ALLOW_REMOTE === "1") return;

  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new Error(
      `Invalid BRIDGE_BASE_URL: ${baseUrl}. Must be a valid URL.`,
    );
  }

  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(
      `Refusing to connect to non-local host "${hostname}". Set MCP_ALLOW_REMOTE=1 to override.`,
    );
  }
}
